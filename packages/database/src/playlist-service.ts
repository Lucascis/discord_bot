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

    async addTrack(playlistId: string, userId: string, track: { title: string; uri: string }) {
        // Check permissions
        const playlist = await this.prisma.playlist.findUnique({
            where: { id: playlistId },
            include: { collaborators: true }
        });

        if (!playlist) throw new Error('Playlist not found');

        const collaborator = playlist.collaborators.find(c => c.userId === userId);
        if (!collaborator && playlist.ownerId !== userId) {
            throw new Error('Permission denied');
        }

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

