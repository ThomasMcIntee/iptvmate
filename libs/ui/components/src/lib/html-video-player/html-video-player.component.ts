import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import Hls from 'hls.js';
import { getExtensionFromUrl } from 'm3u-utils';
import { DataService } from 'services';
import { Channel } from 'shared-interfaces';

/**
 * This component contains the implementation of HTML5 based video player
 */
@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
    standalone: true,
})
export class HtmlVideoPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() startTime = 0;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();

    private readonly dataService = inject(DataService);
    private readonly electronApi = (globalThis as {
        electron?: { setUserAgent?: (userAgent: string, referrer?: string) => void };
    }).electron;

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer!: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls: Hls | null = null;

    /** Captions/subtitles indicator */
    @Input() showCaptions!: boolean;
    /** External subtitle VTT URL to side-load */
    @Input() subtitleUrl: string | null = null;

    ngOnInit() {
        this.videoPlayer.nativeElement.textTracks.addEventListener('addtrack', () => {
            if (this.showCaptions) {
                this.enableCaptions();
            }
        });

        this.videoPlayer.nativeElement.addEventListener('volumechange', () => {
            this.onVolumeChange();
        });

        this.videoPlayer.nativeElement.addEventListener('loadedmetadata', () => {
            if (this.startTime > 0) {
                this.videoPlayer.nativeElement.currentTime = this.startTime;
            }
        });

        this.videoPlayer.nativeElement.addEventListener('timeupdate', () => {
            this.timeUpdate.emit({
                currentTime: this.videoPlayer.nativeElement.currentTime,
                duration: this.videoPlayer.nativeElement.duration,
            });
        });
    }

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && changes['channel'].currentValue) {
            this.playChannel(changes['channel'].currentValue);
        }
        if (changes['volume']?.currentValue !== undefined) {
            this.videoPlayer.nativeElement.volume =
                changes['volume'].currentValue;
        }
        if (changes['subtitleUrl'] && !changes['subtitleUrl'].firstChange) {
            this.applySubtitleTrack();
        }
    }

    /**
     * Starts to play the given channel
     * @param channel given channel object
     */
    playChannel(channel: Channel): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.resetVideoElement();

        if (channel.url) {
            const url = channel.url + (channel.epgParams ?? '');
            const effectiveSourceUrl = this.getEffectiveSourceUrl(channel.url);
            const extension = getExtensionFromUrl(effectiveSourceUrl)?.toLowerCase();

            // Set user agent if specified on channel
            if (channel.http?.['user-agent']) {
                this.electronApi?.setUserAgent?.(
                    channel.http['user-agent'],
                    channel.http.referrer
                );
            }

            if (extension === 'm3u8' && Hls && Hls.isSupported()) {
                this.hls = new Hls();
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.loadSource(url);
                this.handlePlayOperation();
            } else if (extension === 'm3u8') {
                this.playNative(url, 'application/x-mpegURL');
            } else if (extension === 'ts') {
                this.playNative(url, 'video/mp2t');
            } else if (extension === 'mp4') {
                this.playNative(url, 'video/mp4');
            } else {
                this.playNative(url);
            }
            // Side-load external subtitle if provided
            this.applySubtitleTrack();
        }
    }

    private getEffectiveSourceUrl(url: string): string {
        try {
            const parsed = new URL(url);
            const nestedUrl = parsed.searchParams.get('url');
            return nestedUrl ? decodeURIComponent(nestedUrl) : url;
        } catch {
            return url;
        }
    }

    private resetVideoElement(): void {
        const videoElement = this.videoPlayer.nativeElement;
        videoElement.pause();
        videoElement.removeAttribute('src');
        videoElement.load();
    }

    private applySubtitleTrack(): void {
        const video = this.videoPlayer.nativeElement;
        // Remove existing side-loaded subtitle tracks
        const existing = video.querySelectorAll('track[data-sideloaded]');
        existing.forEach((t) => t.remove());

        if (!this.subtitleUrl) return;

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = this.subtitleUrl;
        track.srclang = 'en';
        track.label = 'Subtitles';
        track.setAttribute('data-sideloaded', '1');
        if (this.showCaptions) {
            track.default = true;
        }
        video.appendChild(track);
    }

    private playNative(url: string, type?: string): void {
        const videoElement = this.videoPlayer.nativeElement;
        if (type) {
            videoElement.setAttribute('type', type);
        } else {
            videoElement.removeAttribute('type');
        }
        videoElement.src = url;
        this.handlePlayOperation();
    }

    /**
     * Disables text based captions based on the global settings
     */
    disableCaptions(): void {
        for (
            let i = 0;
            i < this.videoPlayer.nativeElement.textTracks.length;
            i++
        ) {
            this.videoPlayer.nativeElement.textTracks[i].mode = 'hidden';
        }
    }

    /**
     * Enables subtitle/caption tracks
     */
    enableCaptions(): void {
        const tracks = this.videoPlayer.nativeElement.textTracks;
        for (let i = 0; i < tracks.length; i++) {
            if (tracks[i].kind === 'subtitles' || tracks[i].kind === 'captions') {
                tracks[i].mode = 'showing';
            }
        }
    }

    /**
     * Handles promise based play operation
     */
    handlePlayOperation(): void {
        const playPromise = this.videoPlayer.nativeElement.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Automatic playback started!
                    if (!this.showCaptions) {
                        this.disableCaptions();
                    } else {
                        this.enableCaptions();
                    }
                })
                .catch(() => {
                    // Do nothing
                });
        }
    }

    /**
     * Save volume when user changes it
     */
    onVolumeChange(): void {
        const currentVolume = this.videoPlayer.nativeElement.volume;
        localStorage.setItem('volume', currentVolume.toString());
    }

    /**
     * Destroy hls instance on component destroy and clean up event listener
     */
    ngOnDestroy(): void {
        this.videoPlayer.nativeElement.removeEventListener(
            'volumechange',
            this.onVolumeChange
        );
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
