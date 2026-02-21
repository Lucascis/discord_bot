import { PrismaClient } from './client.js';
import { getLogger } from './logger-interface.js';

export class PlaylistService {
    private prisma: PrismaClient;
    private logger = getLogger();

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    async createPlaylist(userId: string, name: string, isPublic: boolean = false) {
        try {
            return await this.prisma.playlist.create({
                data: {
                    name,
                    ownerId: userId,
                    isPublic,
                    collaborators: {
                        create: {
                            userId,
                            permission: 'owner'
                        }
                    }
                }
            });
        } catch (error) {
            this.logger.error({ error, userId, name }, 'Failed to create playlist');
            throw error;
        }
    }

    async getUserPlaylists(userId: string) {
        return await this.prisma.playlist.findMany({
            where: {
                OR: [
                    { ownerId: userId },
                    { collaborators: { some: { userId } } }
                ]
            },
            include: {
                _count: {
                    select: { items: true }
                }
            },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async getPlaylist(playlistId: string) {
        return await this.prisma.playlist.findUnique({
            where: { id: playlistId },
            include: {
                items: {
                    orderBy: { position: 'asc' }
                },
                collaborators: true
            }
        });
    }

    private async assertPlaylistEditPermission(playlistId: string, userId: string) {
        const playlist = await this.prisma.playlist.findUnique({
            where: { id: playlistId },
            include: { collaborators: true }
        });

        if (!playlist) throw new Error('Playlist not found');

        if (playlist.ownerId === userId) {
            return playlist;
        }

        const collaborator = playlist.collaborators.find((c) => c.userId === userId);
        if (!collaborator) {
            throw new Error('Permission denied');
        }
        if (collaborator.permission !== 'owner' && collaborator.permission !== 'edit') {
            throw new Error('Permission denied');
        }
        return playlist;
    }

    async addTrack(playlistId: string, userId: string, track: { title: string; uri: string }) {
        await this.assertPlaylistEditPermission(playlistId, userId);

        // Get last position
        const lastItem = await this.prisma.playlistItem.findFirst({
            where: { playlistId },
            orderBy: { position: 'desc' }
        });

        const position = (lastItem?.position ?? 0) + 1;

        return await this.prisma.playlistItem.create({
            data: {
                playlistId,
                title: track.title,
                uri: track.uri,
                position,
                addedBy: userId
            }
        });
    }

    async updatePlaylist(playlistId: string, userId: string, payload: { name?: string; isPublic?: boolean }) {
        const playlist = await this.prisma.playlist.findUnique({
            where: { id: playlistId }
        });
        if (!playlist) throw new Error('Playlist not found');
        if (playlist.ownerId !== userId) throw new Error('Permission denied');

        return await this.prisma.playlist.update({
            where: { id: playlistId },
            data: {
                ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
                ...(typeof payload.isPublic === 'boolean' ? { isPublic: payload.isPublic } : {})
            }
        });
    }

    async deletePlaylist(playlistId: string, userId: string) {
        const playlist = await this.prisma.playlist.findUnique({
            where: { id: playlistId }
        });
        if (!playlist) throw new Error('Playlist not found');
        if (playlist.ownerId !== userId) throw new Error('Permission denied');

        return await this.prisma.playlist.delete({
            where: { id: playlistId }
        });
    }

    async removeTrack(playlistId: string, userId: string, itemId: string) {
        await this.assertPlaylistEditPermission(playlistId, userId);

        const item = await this.prisma.playlistItem.findUnique({
            where: { id: itemId }
        });

        if (!item || item.playlistId !== playlistId) {
            throw new Error('Track not found');
        }

        await this.prisma.playlistItem.delete({
            where: { id: itemId }
        });

        const remaining = await this.prisma.playlistItem.findMany({
            where: { playlistId },
            orderBy: { position: 'asc' }
        });

        await Promise.all(
            remaining.map((track, index) =>
                this.prisma.playlistItem.update({
                    where: { id: track.id },
                    data: { position: index + 1 }
                })
            )
        );
    }

    async reorderTrack(playlistId: string, userId: string, itemId: string, targetPosition: number) {
        await this.assertPlaylistEditPermission(playlistId, userId);
        const items = await this.prisma.playlistItem.findMany({
            where: { playlistId },
            orderBy: { position: 'asc' }
        });
        const currentIndex = items.findIndex((item) => item.id === itemId);
        if (currentIndex < 0) throw new Error('Track not found');

        const clampedTarget = Math.max(0, Math.min(items.length - 1, targetPosition - 1));
        const [moved] = items.splice(currentIndex, 1);
        items.splice(clampedTarget, 0, moved);

        await Promise.all(
            items.map((item, index) =>
                this.prisma.playlistItem.update({
                    where: { id: item.id },
                    data: { position: index + 1 }
                })
            )
        );
    }

    async addCollaborator(playlistId: string, ownerId: string, collaboratorId: string, permission: 'view' | 'edit' = 'view') {
        const playlist = await this.prisma.playlist.findUnique({ where: { id: playlistId } });
        if (!playlist || playlist.ownerId !== ownerId) {
            throw new Error('Permission denied');
        }

        return await this.prisma.playlistCollaborator.create({
            data: {
                playlistId,
                userId: collaboratorId,
                permission
            }
        });
    }

    async removeCollaborator(playlistId: string, ownerId: string, collaboratorId: string) {
        const playlist = await this.prisma.playlist.findUnique({ where: { id: playlistId } });
        if (!playlist || playlist.ownerId !== ownerId) {
            throw new Error('Permission denied');
        }

        return await this.prisma.playlistCollaborator.delete({
            where: {
                playlistId_userId: {
                    playlistId,
                    userId: collaboratorId
                }
            }
        });
    }
}

