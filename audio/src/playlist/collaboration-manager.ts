/**
 * Playlist Collaboration Manager
 * Real-time collaborative playlist editing
 */

import { EventEmitter } from 'events';
import { logger } from '@discord-bot/logger';
import { PlaylistCollaboration, Playlist, Track } from './types.js';

export interface CollaborationInvite {
  id: string;
  playlistId: string;
  inviterId: string;
  inviteeId: string;
  role: 'viewer' | 'contributor' | 'moderator';
  expiresAt: Date;
  isUsed: boolean;
  createdAt: Date;
}

export interface CollaborationActivity {
  id: string;
  playlistId: string;
  userId: string;
  action: 'track_added' | 'track_removed' | 'track_moved' | 'metadata_updated' | 'user_joined' | 'user_left';
  details: any;
  timestamp: Date;
}

export class CollaborationManager extends EventEmitter {
  private collaborations = new Map<string, PlaylistCollaboration[]>();
  private invites = new Map<string, CollaborationInvite>();
  private activities = new Map<string, CollaborationActivity[]>();
  private activeSessions = new Map<string, Set<string>>(); // playlistId -> Set of userIds

  constructor() {
    super();
    this.setupCleanupInterval();
  }

  /**
   * Invite user to collaborate on playlist
   */
  async inviteUser(
    playlistId: string,
    inviterId: string,
    inviteeId: string,
    role: 'viewer' | 'contributor' | 'moderator',
    expiresIn: number = 7 * 24 * 60 * 60 * 1000 // 7 days
  ): Promise<string | null> {
    // Check if inviter has permission to invite
    const collaboration = this.getCollaboration(playlistId, inviterId);
    if (!collaboration?.permissions.canInviteOthers) {
      return null;
    }

    // Check if user is already a collaborator
    if (this.getCollaboration(playlistId, inviteeId)) {
      return null;
    }

    const inviteId = this.generateInviteId();
    const invite: CollaborationInvite = {
      id: inviteId,
      playlistId,
      inviterId,
      inviteeId,
      role,
      expiresAt: new Date(Date.now() + expiresIn),
      isUsed: false,
      createdAt: new Date()
    };

    this.invites.set(inviteId, invite);

    this.emit('userInvited', invite);
    logger.info({ playlistId, inviterId, inviteeId, role }, 'User invited to playlist');

    return inviteId;
  }

  /**
   * Accept collaboration invite
   */
  async acceptInvite(inviteId: string, userId: string): Promise<boolean> {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.isUsed || invite.expiresAt < new Date() || invite.inviteeId !== userId) {
      return false;
    }

    const permissions = this.getRolePermissions(invite.role);
    const collaboration: PlaylistCollaboration = {
      userId,
      role: invite.role,
      permissions,
      addedAt: new Date()
    };

    if (!this.collaborations.has(invite.playlistId)) {
      this.collaborations.set(invite.playlistId, []);
    }

    this.collaborations.get(invite.playlistId)!.push(collaboration);
    invite.isUsed = true;

    this.logActivity(invite.playlistId, userId, 'user_joined', { role: invite.role });
    this.emit('userJoined', invite.playlistId, collaboration);

    logger.info({ playlistId: invite.playlistId, userId, role: invite.role }, 'User joined playlist collaboration');
    return true;
  }

  /**
   * Remove user from collaboration
   */
  async removeCollaborator(
    playlistId: string,
    targetUserId: string,
    removerId: string
  ): Promise<boolean> {
    const removerCollaboration = this.getCollaboration(playlistId, removerId);
    const targetCollaboration = this.getCollaboration(playlistId, targetUserId);

    if (!targetCollaboration) return false;

    // Check permissions
    if (removerId !== targetUserId && // Can't remove self
        (!removerCollaboration?.permissions.canModerate ||
         targetCollaboration.role === 'admin')) {
      return false;
    }

    const collaborators = this.collaborations.get(playlistId);
    if (!collaborators) return false;

    const index = collaborators.findIndex(c => c.userId === targetUserId);
    if (index === -1) return false;

    collaborators.splice(index, 1);

    // Remove from active session
    this.activeSessions.get(playlistId)?.delete(targetUserId);

    this.logActivity(playlistId, removerId, 'user_left', { removedUser: targetUserId });
    this.emit('userLeft', playlistId, targetUserId);

    logger.info({ playlistId, targetUserId, removerId }, 'User removed from playlist collaboration');
    return true;
  }

  /**
   * Update user role in collaboration
   */
  async updateUserRole(
    playlistId: string,
    targetUserId: string,
    newRole: 'viewer' | 'contributor' | 'moderator',
    updaterId: string
  ): Promise<boolean> {
    const updaterCollaboration = this.getCollaboration(playlistId, updaterId);
    const targetCollaboration = this.getCollaboration(playlistId, targetUserId);

    if (!updaterCollaboration?.permissions.canModerate || !targetCollaboration) {
      return false;
    }

    // Can't demote admin or promote to admin
    if ((targetCollaboration.role as string) === 'admin' || (newRole as string) === 'admin') {
      return false;
    }

    targetCollaboration.role = newRole;
    targetCollaboration.permissions = this.getRolePermissions(newRole);

    this.emit('roleUpdated', playlistId, targetUserId, newRole);
    logger.info({ playlistId, targetUserId, newRole, updaterId }, 'User role updated');

    return true;
  }

  /**
   * Start collaborative session
   */
  async startSession(playlistId: string, userId: string): Promise<boolean> {
    const collaboration = this.getCollaboration(playlistId, userId);
    if (!collaboration) return false;

    if (!this.activeSessions.has(playlistId)) {
      this.activeSessions.set(playlistId, new Set());
    }

    this.activeSessions.get(playlistId)!.add(userId);
    this.emit('sessionStarted', playlistId, userId);

    return true;
  }

  /**
   * End collaborative session
   */
  async endSession(playlistId: string, userId: string): Promise<void> {
    this.activeSessions.get(playlistId)?.delete(userId);

    if (this.activeSessions.get(playlistId)?.size === 0) {
      this.activeSessions.delete(playlistId);
    }

    this.emit('sessionEnded', playlistId, userId);
  }

  /**
   * Get active collaborators
   */
  getActiveCollaborators(playlistId: string): string[] {
    return Array.from(this.activeSessions.get(playlistId) || []);
  }

  /**
   * Get all collaborators for a playlist
   */
  getCollaborators(playlistId: string): PlaylistCollaboration[] {
    return this.collaborations.get(playlistId) || [];
  }

  /**
   * Get specific collaboration
   */
  getCollaboration(playlistId: string, userId: string): PlaylistCollaboration | undefined {
    return this.collaborations.get(playlistId)?.find(c => c.userId === userId);
  }

  /**
   * Check if user can perform action
   */
  canUserPerformAction(
    playlistId: string,
    userId: string,
    action: 'add_tracks' | 'remove_tracks' | 'reorder_tracks' | 'edit_metadata' | 'invite_others' | 'moderate'
  ): boolean {
    const collaboration = this.getCollaboration(playlistId, userId);
    if (!collaboration) return false;

    switch (action) {
      case 'add_tracks': return collaboration.permissions.canAddTracks;
      case 'remove_tracks': return collaboration.permissions.canRemoveTracks;
      case 'reorder_tracks': return collaboration.permissions.canReorderTracks;
      case 'edit_metadata': return collaboration.permissions.canEditMetadata;
      case 'invite_others': return collaboration.permissions.canInviteOthers;
      case 'moderate': return collaboration.permissions.canModerate;
      default: return false;
    }
  }

  /**
   * Get recent activity for playlist
   */
  getRecentActivity(playlistId: string, limit: number = 50): CollaborationActivity[] {
    const activities = this.activities.get(playlistId) || [];
    return activities.slice(-limit).reverse();
  }

  /**
   * Get pending invites for user
   */
  getPendingInvites(userId: string): CollaborationInvite[] {
    return Array.from(this.invites.values())
      .filter(invite =>
        invite.inviteeId === userId &&
        !invite.isUsed &&
        invite.expiresAt > new Date()
      );
  }

  /**
   * Get invite by ID
   */
  getInvite(inviteId: string): CollaborationInvite | undefined {
    return this.invites.get(inviteId);
  }

  /**
   * Broadcast action to active collaborators
   */
  broadcastAction(
    playlistId: string,
    userId: string,
    action: string,
    data: any
  ): void {
    const activeUsers = this.getActiveCollaborators(playlistId);

    this.emit('collaborationAction', {
      playlistId,
      userId,
      action,
      data,
      activeUsers,
      timestamp: new Date()
    });
  }

  /**
   * Handle real-time track addition
   */
  async handleRealtimeTrackAdd(
    playlistId: string,
    userId: string,
    track: Track,
    position?: number
  ): Promise<void> {
    if (!this.canUserPerformAction(playlistId, userId, 'add_tracks')) {
      return;
    }

    this.logActivity(playlistId, userId, 'track_added', {
      track: { id: track.id, title: track.title, artist: track.artist },
      position
    });

    this.broadcastAction(playlistId, userId, 'track_added', {
      track,
      position,
      timestamp: new Date()
    });
  }

  /**
   * Handle real-time track removal
   */
  async handleRealtimeTrackRemove(
    playlistId: string,
    userId: string,
    trackIndex: number,
    track: Track
  ): Promise<void> {
    if (!this.canUserPerformAction(playlistId, userId, 'remove_tracks')) {
      return;
    }

    this.logActivity(playlistId, userId, 'track_removed', {
      track: { id: track.id, title: track.title, artist: track.artist },
      position: trackIndex
    });

    this.broadcastAction(playlistId, userId, 'track_removed', {
      trackIndex,
      track,
      timestamp: new Date()
    });
  }

  /**
   * Handle real-time track reorder
   */
  async handleRealtimeTrackMove(
    playlistId: string,
    userId: string,
    fromIndex: number,
    toIndex: number
  ): Promise<void> {
    if (!this.canUserPerformAction(playlistId, userId, 'reorder_tracks')) {
      return;
    }

    this.logActivity(playlistId, userId, 'track_moved', {
      from: fromIndex,
      to: toIndex
    });

    this.broadcastAction(playlistId, userId, 'track_moved', {
      fromIndex,
      toIndex,
      timestamp: new Date()
    });
  }

  /**
   * Private helper methods
   */
  private getRolePermissions(role: string) {
    switch (role) {
      case 'viewer':
        return {
          canAddTracks: false,
          canRemoveTracks: false,
          canReorderTracks: false,
          canEditMetadata: false,
          canInviteOthers: false,
          canModerate: false
        };
      case 'contributor':
        return {
          canAddTracks: true,
          canRemoveTracks: false,
          canReorderTracks: true,
          canEditMetadata: false,
          canInviteOthers: false,
          canModerate: false
        };
      case 'moderator':
        return {
          canAddTracks: true,
          canRemoveTracks: true,
          canReorderTracks: true,
          canEditMetadata: true,
          canInviteOthers: true,
          canModerate: true
        };
      case 'admin':
        return {
          canAddTracks: true,
          canRemoveTracks: true,
          canReorderTracks: true,
          canEditMetadata: true,
          canInviteOthers: true,
          canModerate: true
        };
      default:
        return {
          canAddTracks: false,
          canRemoveTracks: false,
          canReorderTracks: false,
          canEditMetadata: false,
          canInviteOthers: false,
          canModerate: false
        };
    }
  }

  private generateInviteId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  }

  private logActivity(
    playlistId: string,
    userId: string,
    action: CollaborationActivity['action'],
    details: any
  ): void {
    const activity: CollaborationActivity = {
      id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      playlistId,
      userId,
      action,
      details,
      timestamp: new Date()
    };

    if (!this.activities.has(playlistId)) {
      this.activities.set(playlistId, []);
    }

    const activities = this.activities.get(playlistId)!;
    activities.push(activity);

    // Keep only last 200 activities per playlist
    if (activities.length > 200) {
      activities.splice(0, activities.length - 200);
    }
  }

  private setupCleanupInterval(): void {
    // Clean up expired invites every hour
    setInterval(() => {
      const now = new Date();
      for (const [inviteId, invite] of this.invites.entries()) {
        if (invite.expiresAt < now) {
          this.invites.delete(inviteId);
        }
      }
    }, 60 * 60 * 1000);
  }
}