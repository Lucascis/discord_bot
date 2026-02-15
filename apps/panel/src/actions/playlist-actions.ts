'use server';

import { playlistService } from '@discord-bot/database';
import { auth } from '@/app/auth';
import { revalidatePath } from 'next/cache';

// Helper to get current user
async function getCurrentUser() {
    const session = await auth();
    if (!session?.user?.id) return null;
    return { id: session.user.id };
}

export async function createPlaylist(name: string, isPublic: boolean) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    await playlistService.createPlaylist(user.id, name, isPublic);
    revalidatePath('/dashboard');
}

export async function getUserPlaylists() {
    const user = await getCurrentUser();
    if (!user) return [];
    return await playlistService.getUserPlaylists(user.id);
}

export async function getPlaylist(id: string) {
    return await playlistService.getPlaylist(id);
}

export async function addCollaborator(playlistId: string, collaboratorId: string) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    await playlistService.addCollaborator(playlistId, user.id, collaboratorId);
    revalidatePath('/dashboard');
}
