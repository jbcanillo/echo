// OpenAPI 3 description of the Echo API, served as Swagger UI at /api/docs

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
});

module.exports = function buildSpec({ maxTextLength, maxPromptLength, maxUploadMb, rateLimitPerMinute, synthRanges }) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Echo API',
      version: '1.0.0',
      description:
        'Voice cloning and text generation backend for Echo. ' +
        `The cloning and text generation endpoints are limited to ${rateLimitPerMinute} requests per minute per client.`
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'System', description: 'Service status' },
      { name: 'Voice', description: 'Voice cloning' },
      { name: 'Text', description: 'AI text writing' },
      { name: 'Settings', description: 'OpenRouter key and model' }
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          responses: {
            200: {
              description: 'The service is running',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } }
                }
              }
            }
          }
        }
      },
      '/api/generate-text': {
        post: {
          tags: ['Text'],
          summary: 'Write text from an idea',
          description:
            'Asks the configured OpenRouter model to write text meant to be read aloud (for example "a 5 paragraph bedtime story about monsters"). ' +
            'Requires an OpenRouter API key (set it on the Settings page, or `OPENROUTER_API_KEY` in `.env`).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    prompt: {
                      type: 'string',
                      maxLength: maxPromptLength,
                      example: 'Write me a 5 paragraph bedtime short story about friendly monsters'
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: `The generated text (at most ${maxTextLength} characters)`,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { text: { type: 'string' } } }
                }
              }
            },
            400: errorResponse('Missing or too long prompt'),
            429: errorResponse('Rate limit exceeded'),
            502: errorResponse('The text model failed or returned nothing'),
            503: errorResponse('No OpenRouter API key is configured')
          }
        }
      },
      '/api/enhance-text': {
        post: {
          tags: ['Text'],
          summary: 'Polish text for speech',
          description:
            'Rewrites existing text with the configured OpenRouter model so it sounds natural when read aloud, ' +
            'keeping its meaning and language. Requires an OpenRouter API key (set it on the Settings page, or `OPENROUTER_API_KEY` in `.env`).',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['text'],
                  properties: { text: { type: 'string', maxLength: maxTextLength } }
                }
              }
            }
          },
          responses: {
            200: {
              description: `The rewritten text (at most ${maxTextLength} characters)`,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { text: { type: 'string' } } }
                }
              }
            },
            400: errorResponse('Missing or too long text'),
            429: errorResponse('Rate limit exceeded'),
            502: errorResponse('The text model failed or returned nothing'),
            503: errorResponse('No OpenRouter API key is configured')
          }
        }
      },
      '/api/settings': {
        get: {
          tags: ['Settings'],
          summary: 'Read the settings',
          description: 'The OpenRouter key is write-only: only whether one is set, where it came from and its last four characters are returned.',
          responses: {
            200: {
              description: 'Current settings',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Settings' } } }
            },
            429: errorResponse('Rate limit exceeded')
          }
        },
        put: {
          tags: ['Settings'],
          summary: 'Save the OpenRouter key and model',
          description:
            'Saved on the server (in the models volume) and used for all text endpoints. Send an empty string to remove a saved value and fall back to `.env`. Fields you omit are left unchanged. ' +
            'The API has no accounts, so anyone who can reach it can change these settings.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    openrouterApiKey: { type: 'string', example: 'sk-or-v1-xxxxxxxx' },
                    openrouterModel: { type: 'string', example: 'openai/gpt-4o-mini' }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Updated settings',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { openrouter: { $ref: '#/components/schemas/OpenRouterSettings' } } }
                }
              }
            },
            400: errorResponse('Invalid key or model'),
            429: errorResponse('Rate limit exceeded'),
            500: errorResponse('The settings could not be saved')
          }
        }
      },
      '/api/settings/test': {
        post: {
          tags: ['Settings'],
          summary: 'Test an OpenRouter key',
          description: 'Checks the key in the body (to test before saving), or the saved key if none is sent, against OpenRouter.',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { openrouterApiKey: { type: 'string' } } }
              }
            }
          },
          responses: {
            200: {
              description: 'The key is valid',
              content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } } }
            },
            400: errorResponse('No key to test, or OpenRouter rejected it'),
            429: errorResponse('Rate limit exceeded'),
            502: errorResponse('OpenRouter could not be reached')
          }
        }
      },
      '/api/clone-voice': {
        post: {
          tags: ['Voice'],
          summary: 'Clone a voice and speak text',
          description:
            'Uploads a voice sample and synthesizes the text in that voice. Synthesis runs on the server and can take minutes on CPU, ' +
            'so use a generous client timeout. The caller must confirm they have the voice owner\'s consent.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['voiceSample', 'text', 'consent'],
                  properties: {
                    voiceSample: {
                      type: 'string',
                      format: 'binary',
                      description: `Audio recording of the voice to clone (wav, mp3, m4a, aac, ogg, opus, webm or flac), up to ${maxUploadMb} MB`
                    },
                    text: { type: 'string', maxLength: maxTextLength, description: 'Text to speak' },
                    consent: {
                      type: 'boolean',
                      description: 'Must be true: confirms the speaker is the caller or has given permission'
                    },
                    language: {
                      type: 'string',
                      default: 'en',
                      example: 'en',
                      description: 'Language of the text. The default YourTTS model supports en, fr-fr and pt-br'
                    },
                    speed: {
                      type: 'number',
                      minimum: synthRanges.speed[0],
                      maximum: synthRanges.speed[1],
                      description: 'Speaking speed. 1 is the model default, higher is faster'
                    },
                    expressiveness: {
                      type: 'number',
                      minimum: synthRanges.expressiveness[0],
                      maximum: synthRanges.expressiveness[1],
                      description: 'How much pitch and tone vary. Lower sounds steadier and flatter. Omit to use the model default'
                    },
                    variation: {
                      type: 'number',
                      minimum: synthRanges.variation[0],
                      maximum: synthRanges.variation[1],
                      description: 'How much rhythm and pauses vary. Omit to use the model default'
                    },
                    enhance: {
                      type: 'boolean',
                      default: false,
                      description: 'Rewrite the text with the OpenRouter model before speaking it. The Echo app no longer uses this; it polishes text beforehand through /api/enhance-text'
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'The synthesized speech',
              content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } }
            },
            400: errorResponse('Missing sample, missing or too long text, no consent, or invalid upload'),
            429: errorResponse('Rate limit exceeded'),
            500: errorResponse('Synthesis failed or timed out')
          }
        }
      }
    },
    components: {
      schemas: {
        OpenRouterSettings: {
          type: 'object',
          properties: {
            configured: { type: 'boolean' },
            source: { type: 'string', enum: ['settings', 'env', 'none'], description: 'Where the active key comes from' },
            keyHint: { type: 'string', example: '…a1b2', description: 'Last four characters of the key' },
            model: { type: 'string', example: 'openai/gpt-4o-mini' },
            defaultModel: { type: 'string', example: 'openai/gpt-4o-mini' }
          }
        },
        Settings: {
          type: 'object',
          properties: {
            openrouter: { $ref: '#/components/schemas/OpenRouterSettings' },
            synthesizer: {
              type: 'object',
              properties: {
                ranges: { type: 'object', description: 'Allowed [min, max] for speed, expressiveness and variation' },
                languages: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string', example: 'Text is required' } }
        }
      }
    }
  };
};
