#!/usr/bin/env python3
import os
import sys
import json
from TTS.api import TTS
from pydub import AudioSegment
import uuid
import shutil

def preprocess_audio(input_path, output_path):
    """Convert audio to mono, 16-bit, 22050 Hz WAV"""
    audio = AudioSegment.from_file(input_path)
    processed = audio.set_channels(1).set_sample_width(2).set_frame_rate(22050)
    processed.export(output_path, format="wav")
    return output_path

def main():
    # Read input from command line arguments or stdin
    # Expected format: JSON with voice_sample_path, text, enhance, openrouter_key
    try:
        input_data = json.loads(sys.stdin.read())
        voice_sample_path = input_data['voice_sample_path']
        text = input_data['text']
        enhance = input_data.get('enhance', False)
        openrouter_key = input_data.get('openrouter_key')
        
        # Optional text enhancement via OpenRouter
        final_text = text
        if enhance and openrouter_key:
            try:
                import openai
                client = openai.OpenAI(
                    api_key=openrouter_key,
                    base_url="https://openrouter.ai/api/v1"
                )
                completion = client.chat.completions.create(
                    model="openai/gpt-3.5-turbo",
                    messages=[{
                        "role": "user",
                        "content": f"Make this more natural for speech synthesis: {text}"
                    }]
                )
                final_text = completion.choices[0].message.content.strip()
            except Exception as e:
                print(f"OpenRouter enhancement failed: {e}", file=sys.stderr)
                # If enhancement fails, fallback to original text
        
        # Save uploaded file (it's already saved by Node.js, just use the path)
        input_path = voice_sample_path
        
        # Preprocess audio
        processed_input = f"{os.path.splitext(voice_sample_path)[0]}_processed.wav"
        try:
            preprocess_audio(input_path, processed_input)
        except Exception as e:
            print(json.dumps({"error": f"Audio preprocessing failed: {str(e)}"}))
            return
        
        # Generate output
        output_path = f"{os.path.splitext(voice_sample_path)[0]}_output.wav"
        
        try:
            # Lazy load TTS model
            tts = None
            def get_tts():
                nonlocal tts
                if tts is None:
                    model_name = os.getenv("TTS_MODEL_NAME", "tts_models/multilingual/multi-dataset/yourtts")
                    tts = TTS(model_name).to("cpu")
                return tts
            
            tts_model = get_tts()
            tts_model.tts_to_file(
                text=final_text,
                speaker_wav=processed_input,
                language="en",
                file_path=output_path
            )
            
            # Return the output path
            print(json.dumps({"output_path": output_path}))
            
        except Exception as e:
            print(json.dumps({"error": f"Voice cloning failed: {str(e)}"}))
        finally:
            # Cleanup
            for p in [input_path, processed_input]:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except:
                        pass
                    
    except Exception as e:
        print(json.dumps({"error": f"Failed to process request: {str(e)}"}))

if __name__ == "__main__":
    main()