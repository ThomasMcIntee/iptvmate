import { Injectable } from '@angular/core';
import { PlaybackPositionData } from 'shared-interfaces';

@Injectable({
    providedIn: 'root',
})
export class PlaybackPositionService {
    private get electronApi() {
        return (globalThis as {
            electron?: any;
        }).electron as any;
    }

    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        try {
            await this.electronApi.dbSavePlaybackPosition(playlistId, data);
        } catch (error) {
            console.error('Error saving playback position:', error);
        }
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        try {
            return await this.electronApi.dbGetPlaybackPosition(
                playlistId,
                contentXtreamId,
                contentType
            );
        } catch (error) {
            console.error('Error getting playback position:', error);
            return null;
        }
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        try {
            return await this.electronApi.dbGetSeriesPlaybackPositions(
                playlistId,
                seriesXtreamId
            );
        } catch (error) {
            console.error('Error getting series playback positions:', error);
            return [];
        }
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        try {
            return await this.electronApi.dbGetRecentPlaybackPositions(
                playlistId,
                limit
            );
        } catch (error) {
            console.error('Error getting recent playback positions:', error);
            return [];
        }
    }

    async getAllPlaybackPositions(playlistId: string): Promise<PlaybackPositionData[]> {
        try {
            return await this.electronApi.dbGetAllPlaybackPositions(playlistId);
        } catch (error) {
            console.error('Error getting all playback positions:', error);
            return [];
        }
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        try {
            await this.electronApi.dbClearPlaybackPosition(
                playlistId,
                contentXtreamId,
                contentType
            );
        } catch (error) {
            console.error('Error clearing playback position:', error);
        }
    }
}
