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
    @Output() playbackError = new EventEmitter<void>();

    private player!: Artplayer;
    private hls: Hls | null = null;
    private playbackCandidates: string[] = [];
    private playbackCandidateIndex = 0;
    private startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private hasStartedPlayback = false;
    private currentPlaybackUrl: string | null = null;
    private silenceCheckAttemptedFor: string | null = null;
    private fullTranscodeAttemptedFor: string | null = null;
    private static readonly MAX_AUDIO_TRACK_INDEX = 4;
    private audioContext: AudioContext | null = null;
    private audioAnalyser: AnalyserNode | null = null;
    private audioMediaSource: MediaElementAudioSourceNode | null = null;
    private silenceCheckTimer: ReturnType<typeof setTimeout> | null = null;
    private silenceSamples: number[] = [];

    private readonly elementRef = inject(ElementRef);
    private static readonly PWA_PROXY_BASE = 'http://localhost:3000';

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
        this.clearStartupTimeout();
        this.teardownAudioGraph();
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
        if (!this.channel?.url) {
            return;
        }

        this.playbackCandidates = this.getPlaybackCandidates(this.channel.url);
        this.playbackCandidateIndex = 0;
        this.hasStartedPlayback = false;
        this.silenceCheckAttemptedFor = null;
        this.fullTranscodeAttemptedFor = null;
        const initialUrl = this.playbackCandidates[0] ?? this.channel.url;
        const initialPlaybackUrl = initialUrl + (this.channel.epgParams || '');
        this.currentPlaybackUrl = initialPlaybackUrl;

        const effectiveUrl = this.getEffectiveSourceUrl(initialUrl);
        const lowerUrl = effectiveUrl.toLowerCase();
        const extension = getExtensionFromUrl(effectiveUrl)?.toLowerCase();
        const isLive =
            extension === 'm3u8' ||
            extension === 'ts' ||
            lowerUrl.includes('/live/');

        this.player = new Artplayer({
            container: el,
            url: initialPlaybackUrl,
            volume: this.volume,
            isLive: isLive,
            autoplay: true,
            type: this.getVideoType(initialUrl),
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
                    this.currentPlaybackUrl = url;
                    video.crossOrigin = 'anonymous';
                    // Proxy transcode streams are fragmented MP4, not HLS manifests.
                    if (url.includes('transcode=audio') || url.includes('transcode=1')) {
                        if (this.hls) {
                            this.hls.destroy();
                            this.hls = null;
                        }
                        video.src = url;
                        void video.play().then(() => {
                            this.markPlaybackStarted();
                            this.startSilenceCheck();
                        }).catch(() => {
                            // Browser autoplay policies may block this; user interaction can still start playback.
                        });
                        return;
                    }

                    if (Hls.isSupported()) {
                        if (this.hls) {
                            this.hls.destroy();
                        }
                        this.hls = new Hls({
                            enableWorker: true,
                            lowLatencyMode: false,
                        });
                        this.hls.loadSource(url);
                        this.hls.attachMedia(video);
                        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            void video.play().then(() => {
                                this.markPlaybackStarted();
                                this.startSilenceCheck();
                            }).catch(() => {
                                // Browser autoplay policies may block this; user interaction can still start playback.
                            });
                        });
                        this.hls.on(Hls.Events.ERROR, (_evt, data) => {
                            if (!data.fatal) {
                                return;
                            }

                            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.hls) {
                                this.hls.recoverMediaError();
                                return;
                            }

                            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && this.hls) {
                                this.hls.startLoad();
                            }

                            const nextUrl = this.getNextPlaybackCandidate();
                            if (!nextUrl || !this.hls) {
                                this.playbackError.emit();
                                return;
                            }
                            this.currentPlaybackUrl = nextUrl;
                            this.hls.loadSource(nextUrl);
                        });
                    } else if (
                        video.canPlayType('application/vnd.apple.mpegurl')
                    ) {
                        video.src = url;
                        void video.play().then(() => {
                            this.markPlaybackStarted();
                            this.startSilenceCheck();
                        }).catch(() => {
                            // Browser autoplay policies may block this; user interaction can still start playback.
                        });
                    } else {
                        this.playbackError.emit();
                    }
                },
                mkv: function (video: HTMLVideoElement, url: string) {
                    video.crossOrigin = 'anonymous';
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
            // Use startup timeout for both live and VOD so stalled movie/series
            // playback can trigger higher-level fallback instead of hanging.
            this.startStartupTimeout();
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
            this.markPlaybackStarted();
            this.timeUpdate.emit({
                currentTime: this.player.currentTime,
                duration: this.player.duration,
            });
        });

        this.player.on('video:playing', () => {
            this.markPlaybackStarted();
            this.startSilenceCheck();
        });

        this.player.on('video:error', () => {
            this.clearStartupTimeout();
            this.playbackError.emit();
        });
    }

    private startStartupTimeout(): void {
        this.clearStartupTimeout();
        this.startupTimeoutId = setTimeout(() => {
            if (!this.hasStartedPlayback) {
                this.playbackError.emit();
            }
        }, 6000);
    }

    private markPlaybackStarted(): void {
        this.hasStartedPlayback = true;
        this.clearStartupTimeout();
    }

    private startSilenceCheck(): void {
        const video = this.player?.video as HTMLVideoElement | undefined;
        if (!video) return;
        const sourceUrl = this.currentPlaybackUrl ?? video.currentSrc;
        if (!sourceUrl) return;
        if (!sourceUrl.includes('/stream?url=')) return;
        if (!this.isMovieOrSeriesSource(sourceUrl)) return;
        if (this.silenceCheckAttemptedFor === sourceUrl) return;

        this.stopSilenceCheck();
        this.silenceCheckAttemptedFor = sourceUrl;

        try {
            const Ctor =
                (window as unknown as { AudioContext?: typeof AudioContext })
                    .AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext })
                    .webkitAudioContext;
            if (!Ctor) return;

            const ctx = new Ctor();
            const mediaSource = ctx.createMediaElementSource(video);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            mediaSource.connect(analyser);
            analyser.connect(ctx.destination);

            this.audioContext = ctx;
            this.audioMediaSource = mediaSource;
            this.audioAnalyser = analyser;
            this.silenceSamples = [];

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            const sample = () => {
                if (!this.audioAnalyser) return;
                this.audioAnalyser.getByteTimeDomainData(buffer);
                let peak = 0;
                for (let i = 0; i < buffer.length; i++) {
                    const delta = Math.abs(buffer[i] - 128);
                    if (delta > peak) peak = delta;
                }
                this.silenceSamples.push(peak);

                if (this.silenceSamples.length >= 16) {
                    const maxPeak = Math.max(...this.silenceSamples);
                    this.stopSilenceCheck();
                    if (maxPeak <= 2) {
                        void this.retryAfterSilentPlayback(sourceUrl);
                    }
                    return;
                }

                this.silenceCheckTimer = setTimeout(sample, 250);
            };

            this.silenceCheckTimer = setTimeout(sample, 750);
        } catch {
            this.stopSilenceCheck();
        }
    }

    private stopSilenceCheck(): void {
        if (this.silenceCheckTimer) {
            clearTimeout(this.silenceCheckTimer);
            this.silenceCheckTimer = null;
        }
        this.silenceSamples = [];
    }

    private teardownAudioGraph(): void {
        this.stopSilenceCheck();
        try {
            this.audioMediaSource?.disconnect();
        } catch {
            // ignore
        }
        try {
            this.audioAnalyser?.disconnect();
        } catch {
            // ignore
        }
        if (this.audioContext) {
            void this.audioContext.close().catch(() => undefined);
        }
        this.audioMediaSource = null;
        this.audioAnalyser = null;
        this.audioContext = null;
    }

    private async retryAfterSilentPlayback(sourceUrl: string): Promise<void> {
        if (sourceUrl.includes('transcode=1')) {
            const nextFullTrackUrl = this.withNextAudioTrack(sourceUrl);
            if (nextFullTrackUrl) {
                this.switchToTranscodedUrl(nextFullTrackUrl);
                return;
            }
            this.playbackError.emit();
            return;
        }

        if (sourceUrl.includes('transcode=audio')) {
            const nextAudioTrackUrl = this.withNextAudioTrack(sourceUrl);
            if (nextAudioTrackUrl) {
                this.switchToTranscodedUrl(nextAudioTrackUrl);
                return;
            }

            if (this.fullTranscodeAttemptedFor === sourceUrl) {
                this.playbackError.emit();
                return;
            }
            const fullUrl = this.toFullTranscodeUrl(sourceUrl);
            if (!fullUrl) {
                this.playbackError.emit();
                return;
            }
            this.fullTranscodeAttemptedFor = sourceUrl;
            this.switchToTranscodedUrl(fullUrl);
            return;
        }

        const audioUrl = this.toAudioTranscodeUrl(sourceUrl);
        if (!audioUrl) return;
        this.switchToTranscodedUrl(audioUrl);
    }

    private switchToTranscodedUrl(url: string): void {
        try {
            this.currentPlaybackUrl = url;
            this.hasStartedPlayback = false;
            this.startStartupTimeout();

            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }

            this.player.url = url;
        } catch {
            // let existing player fallback/error flow handle failures
        }
    }

    private toAudioTranscodeUrl(url: string): string | null {
        try {
            const parsed = new URL(url, window.location.origin);
            if (!parsed.pathname.endsWith('/stream')) {
                return null;
            }

            const nestedUrl = parsed.searchParams.get('url');
            if (!nestedUrl) {
                return null;
            }

            if (!this.isMovieOrSeriesSource(url)) {
                return null;
            }

            if (parsed.searchParams.get('transcode') === 'audio') {
                return null;
            }

            parsed.searchParams.set('transcode', 'audio');
            parsed.searchParams.set('aidx', '0');
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private toFullTranscodeUrl(url: string): string | null {
        try {
            const parsed = new URL(url, window.location.origin);
            if (!parsed.pathname.endsWith('/stream')) {
                return null;
            }

            const nestedUrl = parsed.searchParams.get('url');
            if (!nestedUrl) {
                return null;
            }

            if (!this.isMovieOrSeriesSource(url)) {
                return null;
            }

            parsed.searchParams.set('transcode', '1');
            if (!parsed.searchParams.get('aidx')) {
                parsed.searchParams.set('aidx', '0');
            }
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private withNextAudioTrack(url: string): string | null {
        try {
            const parsed = new URL(url, window.location.origin);
            const mode = parsed.searchParams.get('transcode');
            if (mode !== 'audio' && mode !== '1') {
                return null;
            }

            const current = Number.parseInt(parsed.searchParams.get('aidx') ?? '0', 10);
            const currentSafe = Number.isInteger(current) && current >= 0 ? current : 0;
            const next = currentSafe + 1;
            if (next > ArtPlayerComponent.MAX_AUDIO_TRACK_INDEX) {
                return null;
            }

            parsed.searchParams.set('aidx', String(next));
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private isMovieOrSeriesSource(url: string): boolean {
        const effective = this.getEffectiveSourceUrl(url).toLowerCase();
        return effective.includes('/movie/') || effective.includes('/series/');
    }

    private clearStartupTimeout(): void {
        if (this.startupTimeoutId) {
            clearTimeout(this.startupTimeoutId);
            this.startupTimeoutId = null;
        }
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
        if (url.includes('transcode=audio') || url.includes('transcode=1')) {
            return 'mp4';
        }

        const effectiveUrl = this.getEffectiveSourceUrl(url);
        const extension = getExtensionFromUrl(effectiveUrl)?.toLowerCase();
        switch (extension) {
            case 'mkv':
                return 'video/matroska';
            case 'm3u8':
                return 'm3u8';
            case 'ts':
                // Xtream live endpoints are commonly TS-backed live streams.
                return 'm3u8';
            case 'mp4':
                return 'mp4';
            default: {
                // If the URL is a proxy URL (/stream?url=...), fall back to m3u8
                // so the customType handler can use HLS.js regardless of extension.
                const isProxied = url.includes('/stream?url=');
                return isProxied ? 'm3u8' : 'auto';
            }
        }
    }

    private getPlaybackCandidates(url: string): string[] {
        const candidates: string[] = [];
        const sourceUrl = this.ensureProxiedLiveUrl(url);
        const m3u8Url = this.getM3u8VariantUrl(sourceUrl);

        // Prefer HLS manifests as first choice for ArtPlayer/Hls.js.
        if (m3u8Url && m3u8Url !== sourceUrl) {
            candidates.push(m3u8Url);
        }

        candidates.push(sourceUrl);

        return Array.from(new Set(candidates));
    }

    private ensureProxiedLiveUrl(url: string): string {
        const lowerUrl = url.toLowerCase();
        const isHttp = /^https?:\/\//i.test(url);
        const isLiveLike =
            lowerUrl.includes('/live/') ||
            lowerUrl.includes('/live/play/') ||
            lowerUrl.endsWith('.m3u8') ||
            lowerUrl.endsWith('.ts') ||
            lowerUrl.includes('.m3u8?') ||
            lowerUrl.includes('.ts?');

        if (!isHttp || !isLiveLike || lowerUrl.includes('/stream?url=')) {
            return url;
        }

        const hasElectronApi = Boolean(
            (globalThis as { electron?: unknown }).electron
        );
        if (hasElectronApi) {
            return url;
        }

        const proxyBase = (globalThis as { __iptvmateProxyBase?: string })
            .__iptvmateProxyBase || ArtPlayerComponent.PWA_PROXY_BASE;
        const params = new URLSearchParams({ url });
        return `${proxyBase}/stream?${params.toString()}`;
    }

    private getNextPlaybackCandidate(): string | null {
        if (this.playbackCandidateIndex + 1 >= this.playbackCandidates.length) {
            return null;
        }
        this.playbackCandidateIndex += 1;
        return this.playbackCandidates[this.playbackCandidateIndex] ?? null;
    }

    private getM3u8VariantUrl(url: string): string | null {
        const tsRegex = /\.ts(?=$|[?#])/i;
        const m3u8Regex = /\.m3u8(?=$|[?#])/i;

        const appendM3u8ToLivePlayPath = (targetUrl: string): string | null => {
            try {
                const parsed = new URL(targetUrl);
                if (!parsed.pathname.toLowerCase().includes('/live/play/')) {
                    return null;
                }

                const parts = parsed.pathname.split('/');
                const last = parts[parts.length - 1] ?? '';
                if (!last || last.includes('.')) {
                    return null;
                }

                parts[parts.length - 1] = `${last}.m3u8`;
                parsed.pathname = parts.join('/');
                return parsed.toString();
            } catch {
                return null;
            }
        };

        // Handle already proxied URLs: /stream?url=<encoded-original>
        try {
            const outer = new URL(url);
            const nested = outer.searchParams.get('url');
            if (nested) {
                const decodedNested = decodeURIComponent(nested);
                const lowerNested = decodedNested.toLowerCase();
                if (lowerNested.includes('/live/') && tsRegex.test(lowerNested)) {
                    const replacedNested = decodedNested.replace(tsRegex, '.m3u8');
                    outer.searchParams.set('url', replacedNested);
                    return outer.toString();
                }

                if (lowerNested.includes('/live/play/')) {
                    const hlsNested = appendM3u8ToLivePlayPath(decodedNested);
                    if (hlsNested) {
                        outer.searchParams.set('url', hlsNested);
                        return outer.toString();
                    }
                }
            }
        } catch {
            // Fall through to non-proxy replacement.
        }

        const lower = url.toLowerCase();
        if (lower.includes('/live/') && tsRegex.test(lower)) {
            return url.replace(tsRegex, '.m3u8');
        }

        if (lower.includes('/live/play/')) {
            return appendM3u8ToLivePlayPath(url);
        }

        return null;
    }
}
