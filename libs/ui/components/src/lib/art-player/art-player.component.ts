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
} from '@angular/core';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Channel } from 'shared-interfaces';
import { getExtensionFromUrl } from 'm3u-utils';

Artplayer.AUTO_PLAYBACK_TIMEOUT = 10000;

@Component({
    selector: 'app-art-player',
    imports: [],
    template: `<div #artplayer class="artplayer-container"></div>`,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }
            .artplayer-container {
                width: 100%;
                height: 100%;
            }
        `,
    ],
})
export class ArtPlayerComponent implements OnInit, OnDestroy, OnChanges {
    @Input() channel!: Channel;
    @Input() volume = 1;
    @Input() showCaptions = false;
    @Input() startTime = 0;
    @Input() subtitleUrl: string | null = null;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();

    private player!: Artplayer;
    private hls: Hls | null = null;

    private readonly elementRef = inject(ElementRef);

    ngOnInit(): void {
        this.initPlayer();
    }

    ngOnDestroy(): void {
        this.destroyPlayer();
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && !changes['channel'].firstChange) {
            this.destroyPlayer();
            this.initPlayer();
        }
    }

    private destroyPlayer(): void {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.player) {
            this.player.destroy();
        }
    }

    private initPlayer(): void {
        const el = this.elementRef.nativeElement.querySelector(
            '.artplayer-container'
        );
        const effectiveUrl = this.getEffectiveSourceUrl(this.channel.url);
        const lowerUrl = effectiveUrl.toLowerCase();
        const extension = getExtensionFromUrl(effectiveUrl)?.toLowerCase();
        const isLive =
            extension === 'm3u8' ||
            extension === 'ts' ||
            lowerUrl.includes('/live/');

        this.player = new Artplayer({
            container: el,
            url: this.channel.url + (this.channel.epgParams || ''),
            volume: this.volume,
            isLive: isLive,
            autoplay: true,
            type: this.getVideoType(this.channel.url),
            pip: true,
            autoPlayback: true,
            autoSize: true,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            playsInline: true,
            airplay: true,
            backdrop: true,
            mutex: true,
            theme: '#ff0000',
            ...(this.subtitleUrl
                ? {
                      subtitle: {
                          url: this.subtitleUrl,
                          type: 'vtt',
                          encoding: 'utf-8',
                          escape: false,
                          style: {},
                      },
                  }
                : {}),
            customType: {
                m3u8: (video: HTMLVideoElement, url: string) => {
                    if (Hls.isSupported()) {
                        if (this.hls) {
                            this.hls.destroy();
                        }
                        this.hls = new Hls();
                        this.hls.loadSource(url);
                        this.hls.attachMedia(video);
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                    }
                },
                mkv: function (video: HTMLVideoElement, url: string) {
                    video.src = url;
                    // Add error handling
                    video.onerror = () => {
                        console.error('Error loading MKV file:', video.error);
                        // Fallback to treating it as a regular video
                        video.src = url;
                    };
                },
            },
        });

        this.player.on('ready', () => {
            if (this.startTime > 0) {
                this.player.seek = this.startTime;
            }
            const video = this.player.video as HTMLVideoElement | undefined;
            if (video) {
                const applyTracks = () => {
                    for (let i = 0; i < video.textTracks.length; i++) {
                        const t = video.textTracks[i];
                        if (t.kind === 'subtitles' || t.kind === 'captions') {
                            t.mode = this.showCaptions ? 'showing' : 'hidden';
                        }
                    }
                };
                video.textTracks.addEventListener('addtrack', applyTracks);
                applyTracks();
            }
        });

        this.player.on('video:timeupdate', () => {
            this.timeUpdate.emit({
                currentTime: this.player.currentTime,
                duration: this.player.duration,
            });
        });
    }

    private getEffectiveSourceUrl(url: string): string {
        try {
            const parsed = new URL(url);
            const nestedUrl = parsed.searchParams.get('url');
            if (nestedUrl) {
                return decodeURIComponent(nestedUrl);
            }
        } catch {
            return url;
        }

        return url;
    }

    private getVideoType(url: string): string {
        const effectiveUrl = this.getEffectiveSourceUrl(url);
        const extension = getExtensionFromUrl(effectiveUrl)?.toLowerCase();
        switch (extension) {
            case 'mkv':
                return 'video/matroska'; // Changed from 'mkv'
            case 'm3u8':
                return 'm3u8';
            case 'ts':
                // Xtream live endpoints are commonly TS-backed live streams.
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            default:
                return 'auto';
        }
    }
}
