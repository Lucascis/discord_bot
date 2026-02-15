import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmService } from '../services/llm-service';
import { TtsService } from '../services/tts-service';

// Mock logger
vi.mock('@discord-bot/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }),
    },
}));

// Mock Google Cloud TTS
const mockSynthesizeSpeech = vi.fn();
vi.mock('@google-cloud/text-to-speech', () => {
    return {
        TextToSpeechClient: class {
            synthesizeSpeech = mockSynthesizeSpeech;
        }
    };
});

// Mock fetch for OpenAI
global.fetch = vi.fn();

describe('LlmService', () => {
    let llmService: LlmService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.OPENAI_API_KEY = 'test-key';
        llmService = new LlmService();
    });

    it('should generate a script when API key is present', async () => {
        // Mock Tavily (search) then OpenAI (generation)
        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: false, // Search fails or returns empty, shouldn't break generation
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'This is a test script.' } }],
                }),
            });

        const script = await llmService.generateDjScript('Song A', 'Song B');
        expect(script).toBe('This is a test script.');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should return fallback when API key is missing', async () => {
        delete process.env.OPENAI_API_KEY;
        const service = new LlmService();
        const script = await service.generateDjScript('Song A', 'Song B');
        expect(script).toContain('Coming up next is Song B');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should return fallback on API error', async () => {
        (global.fetch as any).mockRejectedValue(new Error('API Error'));
        const script = await llmService.generateDjScript('Song A', 'Song B');
        expect(script).toContain('That was Song A');
    });
});

describe('TtsService', () => {
    let ttsService: TtsService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GOOGLE_APPLICATION_CREDENTIALS = 'test-creds.json';
        ttsService = new TtsService();
    });

    it('should synthesize speech when credentials are present', async () => {
        mockSynthesizeSpeech.mockResolvedValue([{ audioContent: Buffer.from('audio') }]);

        const url = await ttsService.synthesize('Hello world');
        expect(url).toContain('file://');
        expect(url).toContain('.mp3');
        expect(mockSynthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({
            input: { text: 'Hello world' }
        }));
    });

    it('should return fallback when credentials are missing', async () => {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const service = new TtsService();
        const url = await service.synthesize('Hello world');
        expect(url).toContain('soundhelix.com');
        expect(mockSynthesizeSpeech).not.toHaveBeenCalled();
    });
});

describe('LlmService Advanced', () => {
    let llmService: LlmService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.OPENAI_API_KEY = 'test-key';
        // Mock env for Tavily
        vi.mock('@discord-bot/config', () => ({
            env: { TAVILY_API_KEY: 'test-tavily-key' }
        }));
        llmService = new LlmService();
    });

    it('should recommend next track', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Artist - Song' } }],
            }),
        });

        const recommendation = await llmService.recommendNextTrack(['Old Song']);
        expect(recommendation).toBe('Artist - Song');
    });

    it('should use search context in DJ script', async () => {
        // Mock Tavily response then OpenAI response
        (global.fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [{ content: 'Fun fact about the song.' }] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'DJ Script with fact.' } }],
                }),
            });

        const script = await llmService.generateDjScript('Last Song', 'Next Song');
        expect(script).toBe('DJ Script with fact.');
        // Verify Tavily was called
        expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://api.tavily.com/search', expect.anything());
    });
});
