'use client';

import { useState, useEffect } from 'react';
import {
    addTrackToPlaylist,
    createPlaylist,
    deletePlaylist,
    getPlaylist,
    getUserPlaylists,
    removeTrackFromPlaylist,
    reorderPlaylistTrack,
    updatePlaylist
} from '@/actions/playlist-actions';
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
    const [newTrackTitle, setNewTrackTitle] = useState('');
    const [newTrackUri, setNewTrackUri] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

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
        const next = (data as PlaylistDetails | null) ?? null;
        setDetails(next);
        setRenameValue(next?.name ?? '');
    }

    async function handleCreate() {
        if (!newPlaylistName.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await createPlaylist(newPlaylistName, false);
            setNewPlaylistName('');
            setIsCreating(false);
            await loadPlaylists();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'No pudimos crear la playlist.');
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteSelected() {
        if (!selectedPlaylistId) return;
        if (!window.confirm('¿Eliminar esta playlist? Esta acción no se puede deshacer.')) return;
        setSaving(true);
        setError(null);
        try {
            await deletePlaylist(selectedPlaylistId);
            setSelectedPlaylistId(null);
            setDetails(null);
            await loadPlaylists();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'No pudimos eliminar la playlist.');
        } finally {
            setSaving(false);
        }
    }

    async function handleRenameAndVisibility() {
        if (!selectedPlaylistId || !details) return;
        setSaving(true);
        setError(null);
        try {
            await updatePlaylist(selectedPlaylistId, { name: renameValue.trim() || details.name, isPublic: details.isPublic });
            await loadDetails(selectedPlaylistId);
            await loadPlaylists();
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : 'No pudimos actualizar la playlist.');
        } finally {
            setSaving(false);
        }
    }

    async function handleTogglePublic() {
        if (!selectedPlaylistId || !details) return;
        setSaving(true);
        setError(null);
        try {
            await updatePlaylist(selectedPlaylistId, { isPublic: !details.isPublic });
            await loadDetails(selectedPlaylistId);
            await loadPlaylists();
        } catch (toggleError) {
            setError(toggleError instanceof Error ? toggleError.message : 'No pudimos actualizar visibilidad.');
        } finally {
            setSaving(false);
        }
    }

    async function handleAddTrack() {
        if (!selectedPlaylistId || !newTrackUri.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await addTrackToPlaylist(selectedPlaylistId, {
                title: newTrackTitle.trim() || 'Track from URL',
                uri: newTrackUri.trim()
            });
            setNewTrackTitle('');
            setNewTrackUri('');
            await loadDetails(selectedPlaylistId);
        } catch (trackError) {
            setError(trackError instanceof Error ? trackError.message : 'No pudimos agregar el track.');
        } finally {
            setSaving(false);
        }
    }

    async function handleRemoveTrack(itemId: string) {
        if (!selectedPlaylistId) return;
        setSaving(true);
        setError(null);
        try {
            await removeTrackFromPlaylist(selectedPlaylistId, itemId);
            await loadDetails(selectedPlaylistId);
        } catch (trackError) {
            setError(trackError instanceof Error ? trackError.message : 'No pudimos quitar el track.');
        } finally {
            setSaving(false);
        }
    }

    async function handleMoveTrack(itemId: string, delta: number, currentPosition: number) {
        if (!selectedPlaylistId || !details) return;
        const targetPosition = currentPosition + delta;
        if (targetPosition < 1 || targetPosition > details.items.length) return;
        setSaving(true);
        setError(null);
        try {
            await reorderPlaylistTrack(selectedPlaylistId, itemId, targetPosition);
            await loadDetails(selectedPlaylistId);
        } catch (trackError) {
            setError(trackError instanceof Error ? trackError.message : 'No pudimos reordenar el track.');
        } finally {
            setSaving(false);
        }
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
                                disabled={saving}
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
                {error && <p className="text-xs text-rose-300/90">{error}</p>}
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

                        <div className="grid gap-3 md:grid-cols-3">
                            <input
                                type="text"
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                className="rounded-lg bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                placeholder="Playlist name"
                            />
                            <button
                                type="button"
                                onClick={handleRenameAndVisibility}
                                disabled={saving}
                                className="rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                            >
                                Save Name
                            </button>
                            <button
                                type="button"
                                onClick={handleTogglePublic}
                                disabled={saving}
                                className="rounded-md border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
                            >
                                {details.isPublic ? 'Make Private' : 'Make Public'}
                            </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                            <input
                                type="text"
                                value={newTrackTitle}
                                onChange={(event) => setNewTrackTitle(event.target.value)}
                                className="rounded-lg bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                placeholder="Track title"
                            />
                            <input
                                type="text"
                                value={newTrackUri}
                                onChange={(event) => setNewTrackUri(event.target.value)}
                                className="md:col-span-2 rounded-lg bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                                placeholder="https://..."
                            />
                            <button
                                type="button"
                                onClick={handleAddTrack}
                                disabled={saving || !newTrackUri.trim()}
                                className="rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                            >
                                Add track
                            </button>
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
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleMoveTrack(item.id, -1, index + 1)}
                                                disabled={saving || index === 0}
                                                className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-30"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleMoveTrack(item.id, 1, index + 1)}
                                                disabled={saving || index === details.items.length - 1}
                                                className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-30"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveTrack(item.id)}
                                                disabled={saving}
                                                className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-200 disabled:opacity-30"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleDeleteSelected}
                                disabled={saving}
                                className="rounded-md border border-rose-500/40 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-40"
                            >
                                Delete playlist
                            </button>
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
