/**
 * Advanced Playlist System - Main Export
 * Professional playlist management for Discord Music Bot
 */

export * from './types.js';
export { PlaylistManager } from './playlist-manager.js';
export { CollaborationManager } from './collaboration-manager.js';

import { PlaylistManager } from './playlist-manager.js';
import { CollaborationManager } from './collaboration-manager.js';

// Create singleton instances
export const playlistManager = new PlaylistManager();
export const collaborationManager = new CollaborationManager();

// Set up integration between managers
playlistManager.on('trackAdded', (playlistId, track, position) => {
  collaborationManager.handleRealtimeTrackAdd(playlistId, track.addedBy!, track, position);
});

playlistManager.on('trackRemoved', (playlistId, track, index) => {
  const lastEvent = playlistManager.getPlaylist(playlistId);
  // Get user from last event context - simplified for now
  collaborationManager.handleRealtimeTrackRemove(playlistId, 'system', index, track);
});

playlistManager.on('tracksReordered', (playlistId, fromIndex, toIndex) => {
  // Get user from last event context - simplified for now
  collaborationManager.handleRealtimeTrackMove(playlistId, 'system', fromIndex, toIndex);
});

// Cross-system event forwarding
collaborationManager.on('collaborationAction', (action) => {
  playlistManager.emit('collaborationAction', action);
});

collaborationManager.on('userJoined', (playlistId, collaboration) => {
  playlistManager.emit('userJoinedPlaylist', playlistId, collaboration);
});

collaborationManager.on('userLeft', (playlistId, userId) => {
  playlistManager.emit('userLeftPlaylist', playlistId, userId);
});