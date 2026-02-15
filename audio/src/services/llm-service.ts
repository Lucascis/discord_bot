import { logger } from '@discord-bot/logger';
import { env } from '@discord-bot/config';

export class LlmService {
    private logger = logger.child({ service: 'LlmService' });
    private apiKey: string;
    private endpoint = 'https://api.openai.com/v1/chat/completions';

    private tavilyApiKey: string;

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        this.tavilyApiKey = env.TAVILY_API_KEY || '';

        if (!this.apiKey) {
            this.logger.warn('OPENAI_API_KEY not set. AI DJ will fail if triggered.');
        }
    }

    private async searchContext(query: string): Promise<string> {
        if (!this.tavilyApiKey) return '';

        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: this.tavilyApiKey,
                    query: `${query} music artist song facts`,
                    search_depth: 'basic',
                    max_results: 1
                })
            });

            if (!response.ok) return '';

            const data = await response.json();
            const result = data.results?.[0]?.content;
            return result ? `Context: ${result.substring(0, 200)}...` : '';
        } catch (error) {
            this.logger.warn({ error }, 'Failed to fetch search context');
            return '';
        }
    }

    async generateDjScript(lastTrackTitle: string, nextTrackTitle: string): Promise<string> {
        if (!this.apiKey) {
            this.logger.warn('Skipping LLM generation: No API Key');
            return `Coming up next is ${nextTrackTitle}. Stay tuned!`;
        }

        try {
            // Fetch context for the next track
            const context = await this.searchContext(nextTrackTitle);

            const prompt = `You are a cool, energetic radio DJ for a Discord music bot. 
      The last song was "${lastTrackTitle}" and the next song is "${nextTrackTitle}".
      ${context ? `Here is some info about the next song/artist: "${context}"` : ''}
      
      Write a very short (max 2 sentences), punchy transition script. 
      ${context ? 'Incorporate a cool fact from the info if possible.' : ''}
      Do not include "DJ:" or quotes. Just the spoken text.`;

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a professional radio DJ.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 100,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API Error: ${response.statusText}`);
            }

            const data = await response.json();
            const script = data.choices[0]?.message?.content?.trim();

            return script || `Up next, we have ${nextTrackTitle}.`;
        } catch (error) {
            this.logger.error({ error }, 'Failed to generate DJ script');
            return `That was ${lastTrackTitle}, and now getting ready for ${nextTrackTitle}.`;
        }
    }
    async recommendNextTrack(recentTracks: string[]): Promise<string | null> {
        if (!this.apiKey) return null;

        try {
            const prompt = `You are a sophisticated music curator (AI DJ).
            The user has recently listened to:
            ${recentTracks.slice(-5).map(t => `- ${t}`).join('\n')}

            Based on this history, recommend ONE song to play next that fits the vibe but keeps it fresh.
            Return ONLY the "Artist - Title" of the song. No other text.`;

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a professional music curator.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 50,
                    temperature: 0.8
                })
            });

            if (!response.ok) return null;

            const data = await response.json();
            const recommendation = data.choices[0]?.message?.content?.trim();

            // Basic cleanup to remove quotes if present
            return recommendation ? recommendation.replace(/^"|"$/g, '') : null;
        } catch (error) {
            this.logger.error({ error }, 'Failed to generate song recommendation');
            return null;
        }
    }
}

