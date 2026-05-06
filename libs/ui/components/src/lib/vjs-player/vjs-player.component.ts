import {
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    Output,
    SimpleChanges,
    ViewChild,
    ViewEncapsulation,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import videoJs from 'video.js';
import 'videojs-quality-selector-hls';

type PlayerSource = { src: string; type?: string };

/**
 * This component contains the implementation of video player that is based on video.js library
 */
@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: true,
})
export class VjsPlayerComponent
    implements AfterViewInit, OnChanges, OnDestroy
{
    /** DOM-element reference */
    @ViewChild('target') target!: ElementRef<Element>;
    /** Options of VideoJs player */
    @Input() options!: NonNullable<Parameters<typeof videoJs>[1]>;
    /** VideoJs object */
    player!: ReturnType<typeof videoJs>;
    @Input() volume = 1;
    @Input() startTime = 0;
    @Input() showCaptions = false;
    @Input() subtitleUrl: string | null = null;
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    private pendingSources: PlayerSource[] | null = null;
    private isDestroyed = false;
    private lastAppliedSourcesKey: string | null = null;

    ngAfterViewInit(): void {
        this.initializePlayer();
    }

    private initializePlayer(): void {
        if (this.player || this.isDestroyed) {
            return;
        }

        const playerElement = this.target?.nativeElement as HTMLElement | undefined;
        if (!playerElement?.isConnected) {
            return;
        }

        const initialSources = this.normalizeSources(
            this.pendingSources ?? this.options?.sources
        );
        const baseOptions = { ...(this.options ?? {}) };
        delete (baseOptions as { sources?: unknown }).sources;

        this.player = videoJs(
            playerElement,
            {
                ...baseOptions,
                autoplay: true,
            },
            () => {
                try {
                    this.player.volume(this.volume);
                } catch (e) {
                    console.warn('Failed to set initial VideoJS volume:', e);
                }

                this.player.on('loadedmetadata', () => {
                    if (this.startTime > 0) {
                        this.player.currentTime(this.startTime);
                    }
                });

                this.player.on('volumechange', () => {
                    const currentVolume = this.player.volume();
                    if (typeof currentVolume === 'number') {
                        localStorage.setItem('volume', currentVolume.toString());
                    }
                });

                this.player.on('timeupdate', () => {
                    const currentTime = this.player.currentTime() ?? 0;
                    const duration = this.player.duration() ?? 0;
                    this.timeUpdate.emit({
                        currentTime,
                        duration,
                    });
                });

                const trackList = this.player.textTracks();
                trackList.on('addtrack', () => this.applyTextTrackSettings());
                this.applyTextTrackSettings();

                if (initialSources.length > 0) {
                    this.setPlayerSource(initialSources);
                }

                if (this.subtitleUrl) {
                    this.loadSubtitleTrack(this.subtitleUrl);
                }
            }
        );
        this.pendingSources = null;

        try {
            const playerWithQualitySelector = this.player as ReturnType<typeof videoJs> & {
                qualitySelectorHls?: (options: {
                    displayCurrentQuality: boolean;
                }) => void;
            };
            if (typeof playerWithQualitySelector.qualitySelectorHls === 'function') {
                playerWithQualitySelector.qualitySelectorHls({
                    displayCurrentQuality: true,
                });
            }
        } catch (e) {
            console.warn('qualitySelectorHls plugin failed to initialize:', e);
        }
        try {
            const playerWithAspectPanel = this.player as ReturnType<typeof videoJs> & {
                aspectRatioPanel?: () => void;
            };
            if (typeof playerWithAspectPanel.aspectRatioPanel === 'function') {
                playerWithAspectPanel.aspectRatioPanel();
            }
        } catch (e) {
            console.warn('aspectRatioPanel plugin failed to initialize:', e);
        }
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['options']?.currentValue?.sources?.[0]) {
            const nextSources = this.normalizeSources(
                changes['options'].currentValue.sources
            );
            if (!this.player) {
                this.pendingSources = nextSources;
            } else {
                this.setPlayerSource(nextSources);
                if (this.subtitleUrl) {
                    this.loadSubtitleTrack(this.subtitleUrl);
                }
            }
        }
        if (changes['volume']?.currentValue !== undefined && this.player) {
            try {
                this.player.volume(changes['volume'].currentValue);
            } catch (e) {
                console.warn('Failed to set VideoJS volume:', e);
            }
        }
        if (changes['showCaptions'] && this.player) {
            this.applyTextTrackSettings();
        }
        if (changes['subtitleUrl'] && this.player && this.subtitleUrl) {
            this.loadSubtitleTrack(this.subtitleUrl);
        }
    }

    private loadSubtitleTrack(url: string): void {
        if (!this.player) return;
        // Remove any previously side-loaded subtitle tracks
        const existing = this.player.textTracks() as unknown as TextTrackList;
        for (let i = existing.length - 1; i >= 0; i--) {
            const t = existing[i];
            const trackWithSrc = t as TextTrack & { src?: string };
            if (trackWithSrc.src && (t.kind === 'subtitles' || t.kind === 'captions')) {
                this.player.removeRemoteTextTrack(t as unknown as Parameters<typeof this.player.removeRemoteTextTrack>[0]);
            }
        }
        this.player.addRemoteTextTrack(
            {
                kind: 'subtitles',
                src: url,
                srclang: 'en',
                label: 'Subtitles',
                default: this.showCaptions,
            },
            false
        );
    }

    private applyTextTrackSettings(): void {
        if (!this.player) return;
        const tracks = this.player.textTracks() as unknown as TextTrackList;
        for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            if (t.kind === 'subtitles' || t.kind === 'captions') {
                (t as unknown as { mode: string }).mode = this.showCaptions ? 'showing' : 'hidden';
            }
        }
    }

    private normalizeSources(
        sources: PlayerSource[] | PlayerSource | undefined
    ): PlayerSource[] {
        if (!sources) {
            return [];
        }

        const list = Array.isArray(sources) ? sources : [sources];
        return list
            .filter((source): source is PlayerSource => !!source?.src)
            .map((source) =>
                source.type
                    ? { src: source.src, type: source.type }
                    : { src: source.src }
            );
    }

    private getSourcesKey(sources: PlayerSource[]): string {
        return JSON.stringify(sources.map((s) => [s.src, s.type ?? '']));
    }

    private setPlayerSource(
        sourcesInput: PlayerSource[] | PlayerSource,
        allowTypeFallback = true
    ): void {
        if (!this.player) {
            return;
        }

        const normalizedSources = this.normalizeSources(sourcesInput);
        if (normalizedSources.length === 0) {
            return;
        }

        const nextSourcesKey = this.getSourcesKey(normalizedSources);
        if (this.lastAppliedSourcesKey === nextSourcesKey) {
            return;
        }
        this.lastAppliedSourcesKey = nextSourcesKey;

        if (
            allowTypeFallback &&
            normalizedSources.length === 1 &&
            normalizedSources[0].type
        ) {
            const typedSource = normalizedSources[0];
            const onSourceError = () => {
                const currentError = this.player?.error();
                if (currentError?.code === 4) {
                    console.warn(
                        'VideoJS source not supported with explicit type; retrying without type.',
                        typedSource
                    );
                    this.setPlayerSource({ src: typedSource.src }, false);
                }
            };

            this.player.one('error', onSourceError);
        }

        this.player.pause();
        this.player.src(normalizedSources as Parameters<typeof this.player.src>[0]);
        this.player.load();

        if (this.subtitleUrl) {
            this.loadSubtitleTrack(this.subtitleUrl);
        }

        const playPromise = this.player.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err: unknown) => {
                if (
                    err instanceof DOMException &&
                    err.name === 'AbortError'
                ) {
                    return;
                }
                console.warn('VideoJS failed to autoplay after source switch:', err);
            });
        }
    }

    /**
     * Removes the players HTML reference on destroy
     */
    ngOnDestroy(): void {
        this.isDestroyed = true;
        if (this.player) {
            this.player.dispose();
        }
    }
}
