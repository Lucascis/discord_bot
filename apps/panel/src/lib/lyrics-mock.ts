export interface LyricLine {
    time: number;
    text: string;
}

export const MOCK_LYRICS: LyricLine[] = [
    { time: 0, text: "♪ Instrumental Intro ♪" },
    { time: 15000, text: "Is this the real life?" },
    { time: 18000, text: "Is this just fantasy?" },
    { time: 22000, text: "Caught in a landslide" },
    { time: 25000, text: "No escape from reality" },
    { time: 30000, text: "Open your eyes" },
    { time: 33000, text: "Look up to the skies and see" },
    { time: 38000, text: "I'm just a poor boy, I need no sympathy" },
    { time: 42000, text: "Because I'm easy come, easy go" },
    { time: 45000, text: "Little high, little low" },
    { time: 48000, text: "Any way the wind blows" },
    { time: 51000, text: "Doesn't really matter to me, to me" },
    { time: 60000, text: "Mama, just killed a man" },
    { time: 65000, text: "Put a gun against his head" },
    { time: 68000, text: "Pulled my trigger, now he's dead" },
    { time: 72000, text: "Mama, life had just begun" },
    { time: 77000, text: "But now I've gone and thrown it all away" },
    { time: 83000, text: "Mama, ooh" },
    { time: 90000, text: "Didn't mean to make you cry" },
    { time: 95000, text: "If I'm not back again this time tomorrow" },
    { time: 100000, text: "Carry on, carry on as if nothing really matters" },
];

export function getSyncedLyric(positionMs: number): string {
    const line = MOCK_LYRICS.slice().reverse().find(l => l.time <= positionMs);
    return line ? line.text : "♪";
}
