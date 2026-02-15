'use client';

import { useState, useEffect } from 'react';
import { getUserPlaylists, createPlaylist, getPlaylist } from '@/actions/playlist-actions';
import clsx from 'clsx';

interface Playlist {
    id: string;
    name: string;
    ownerId: string;
    isPublic: boolean;
    _count?: { items: number };
}

interface PlaylistDetails extends Playlist {
    items: { id: string; title: string; uri: string; position: number }[];
    collaborators: { userId: string; permission: string }[];
}

export function PlaylistManager() {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
    const [details, setDetails] = useState<PlaylistDetails | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState('');

    useEffect(() => {
        loadPlaylists();
    }, []);

    useEffect(() => {
        if (selectedPlaylistId) {
            loadDetails(selectedPlaylistId);
        } else {
            setDetails(null);
        }
    }, [selectedPlaylistId]);

    async function loadPlaylists() {
        const data = await getUserPlaylists();
        setPlaylists(Array.isArray(data) ? (data as Playlist[]) : []);
    }

    async function loadDetails(id: string) {
        const data = await getPlaylist(id);
        setDetails((data as PlaylistDetails | null) ?? null);
    }

    async function handleCreate() {
        if (!newPlaylistName.trim()) return;
        await createPlaylist(newPlaylistName, false);
        setNewPlaylistName('');
        setIsCreating(false);
        loadPlaylists();
    }

    return (
        <div className="flex h-full gap-6">
            {/* Playlist List */}
            <div className="w-1/3 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold">My Playlists</h2>
                    <button
                        onClick={() => setIsCreating(!isCreating)}
                        className="rounded-lg bg-brand-500/20 px-3 py-1 text-sm font-medium text-brand-200 hover:bg-brand-500/30"
                    >
                        + New
                    </button>
                </div>

                {isCreating && (
                    <div className="rounded-xl bg-white/5 p-4 space-y-3">
                        <input
                            type="text"
                            value={newPlaylistName}
                            onChange={(e) => setNewPlaylistName(e.target.value)}
                            placeholder="Playlist Name"
                            className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setIsCreating(false)}
                                className="text-xs text-white/60 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    {playlists.map((playlist) => (
                        <button
                            key={playlist.id}
                            onClick={() => setSelectedPlaylistId(playlist.id)}
                            className={clsx(
                                "w-full rounded-xl p-3 text-left transition-all",
                                selectedPlaylistId === playlist.id
                                    ? "bg-white/10 text-white shadow-lg"
                                    : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                            )}
                        >
                            <div className="font-medium">{playlist.name}</div>
                            <div className="text-xs text-white/40">{playlist._count?.items ?? 0} tracks</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Playlist Details */}
            <div className="flex-1 rounded-2xl border border-white/5 bg-black/20 p-6 backdrop-blur-sm">
                {details ? (
                    <div className="space-y-6">
                        <div className="flex items-start justify-between">
                            <div>
                                <h1 className="text-3xl font-bold">{details.name}</h1>
                                <p className="text-white/40">
                                    Created by {details.ownerId} • {details.isPublic ? 'Public' : 'Private'}
                                </p>
                            </div>
                            <div className="flex -space-x-2">
                                {details.collaborators.map((c) => (
                                    <div
                                        key={c.userId}
                                        className="h-8 w-8 rounded-full bg-brand-500 flex items-center justify-center text-xs border-2 border-black"
                                        title={c.userId}
                                    >
                                        {c.userId.substring(0, 2)}
                                    </div>
                                ))}
                                <button className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs border-2 border-black hover:bg-white/20">
                                    +
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {details.items.length === 0 ? (
                                <div className="text-center py-12 text-white/20">
                                    No tracks yet. Add some!
                                </div>
                            ) : (
                                details.items.map((item, index) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center gap-4 rounded-lg bg-white/5 p-3 hover:bg-white/10 group"
                                    >
                                        <span className="w-6 text-center text-white/40 font-mono text-sm">{index + 1}</span>
                                        <div className="flex-1">
                                            <div className="font-medium">{item.title}</div>
                                            <div className="text-xs text-white/40 truncate">{item.uri}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-white/20">
                        Select a playlist to view details
                    </div>
                )}
            </div>
        </div>
    );
}
