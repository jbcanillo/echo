#!/usr/bin/env python3
"""Long-running voice cloning worker.

Reads one JSON job per line on stdin and writes one JSON result per line on
stdout, so the TTS model is loaded once instead of on every request.

Job:    {"id", "voice_sample_path", "output_path", "text", "language", "speed", "expressiveness",
         "variation", "enhance", "openrouter_key", "openrouter_model"}   (the last three are optional)
Result: {"id", "output_path"} or {"id", "error"}
"""
import json
import os
import sys

from pydub import AudioSegment

# TTS and other libraries print progress to stdout; keep the real stdout for
# the JSON protocol and send everything else to stderr.
protocol_out = sys.stdout
sys.stdout = sys.stderr

_tts = None


def get_tts():
    global _tts
    if _tts is None:
        from TTS.api import TTS
        model_name = os.getenv("TTS_MODEL_NAME") or "tts_models/multilingual/multi-dataset/your_tts"
        _tts = TTS(model_name).to("cpu")
    return _tts


def preprocess_audio(input_path, output_path):
    """Convert audio to mono, 16-bit, 22050 Hz WAV"""
    audio = AudioSegment.from_file(input_path)
    processed = audio.set_channels(1).set_sample_width(2).set_frame_rate(22050)
    processed.export(output_path, format="wav")
    return output_path


def enhance_text(text, openrouter_key, model=None):
    """Rewrite text to sound more natural when spoken; fall back to the original on failure."""
    try:
        import openai
        client = openai.OpenAI(api_key=openrouter_key, base_url="https://openrouter.ai/api/v1")
        completion = client.chat.completions.create(
            model=model or os.getenv("OPENROUTER_MODEL") or "openai/gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "Rewrite the user's text so it sounds natural when read aloud by a "
                               "speech synthesizer. Keep the meaning and language. Reply with the "
                               "rewritten text only, without quotes or commentary.",
                },
                {"role": "user", "content": text},
            ],
        )
        enhanced = (completion.choices[0].message.content or "").strip()
        return enhanced or text
    except Exception as e:
        print(f"OpenRouter enhancement failed: {e}", file=sys.stderr)
        return text


def apply_synth_settings(tts, job):
    """Tune the voice model for one job and return the values to restore afterwards.

    YourTTS is a VITS model: speed maps to length_scale (its inverse), expressiveness to the
    inference noise scale and variation to the duration noise scale.
    """
    model = getattr(getattr(tts, "synthesizer", None), "tts_model", None)
    previous = {}
    if model is None:
        return previous
    speed = job.get("speed")
    wanted = {
        "length_scale": (1.0 / speed) if speed else None,
        "inference_noise_scale": job.get("expressiveness"),
        "inference_noise_scale_dp": job.get("variation"),
    }
    for attr, value in wanted.items():
        if value is None:
            continue
        if not hasattr(model, attr):
            print(f"Voice model has no '{attr}' setting; ignoring it", file=sys.stderr)
            continue
        previous[attr] = getattr(model, attr)
        setattr(model, attr, value)
    return previous


def process(job):
    voice_sample_path = job["voice_sample_path"]
    output_path = job["output_path"]
    text = job["text"]

    if job.get("enhance") and job.get("openrouter_key"):
        text = enhance_text(text, job["openrouter_key"], job.get("openrouter_model"))

    processed_input = f"{os.path.splitext(voice_sample_path)[0]}_processed.wav"
    try:
        try:
            preprocess_audio(voice_sample_path, processed_input)
        except Exception as e:
            return {"error": f"Audio preprocessing failed: {e}"}

        previous = {}
        try:
            tts = get_tts()
            previous = apply_synth_settings(tts, job)
            tts.tts_to_file(
                text=text,
                speaker_wav=processed_input,
                language=job.get("language") or "en",
                file_path=output_path,
            )
        except Exception as e:
            return {"error": f"Voice cloning failed: {e}"}
        finally:
            # The model is shared between requests, so put its settings back
            model = getattr(getattr(_tts, "synthesizer", None), "tts_model", None)
            for attr, value in previous.items():
                setattr(model, attr, value)

        return {"output_path": output_path}
    finally:
        if os.path.exists(processed_input):
            try:
                os.remove(processed_input)
            except OSError:
                pass


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job_id = None
        try:
            job = json.loads(line)
            job_id = job.get("id")
            result = process(job)
        except Exception as e:
            result = {"error": f"Failed to process request: {e}"}
        result["id"] = job_id
        protocol_out.write(json.dumps(result) + "\n")
        protocol_out.flush()


if __name__ == "__main__":
    main()
