import {
    Component,
    EventEmitter,
    Output,
    Signal,
    ViewEncapsulation,
    effect,
    inject,
    input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { StorageMap } from '@ngx-pwa/local-storage';
import {
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    VjsPlayerComponent,
} from 'components';
import { getExtensionFromUrl } from 'm3u-utils';
import { STORE_KEY, Settings, VideoPlayer } from 'shared-interfaces';

@Component({
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
    imports: [ArtPlayerComponent, HtmlVideoPlayerComponent, VjsPlayerComponent],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent {
    storage = inject(StorageMap);
    private streamVersion = 0;
    private static readonly XTREAM_TS_SUFFIX_REGEX = /\.ts(?=$|[?#])/i;

    streamUrl = input.required<string>();
    startTime = input<number>(0);
    subtitleUrl = input<string | null>(null);
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();

    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;

    get showCaptions(): boolean {
        return this.settings()?.showCaptions ?? false;
    }

    channel!: { url: string };
    player!: VideoPlayer;
    vjsOptions!: { sources: { src: string; type?: string }[] };

    constructor() {
        effect(() => {
            this.player = this.settings()?.player;
            void this.applyStreamUrl(this.streamUrl());
        });
    }

    private async applyStreamUrl(streamUrl: string): Promise<void> {
        const currentVersion = ++this.streamVersion;
        const resolvedStreamUrl = await this.getPlayableUrl(streamUrl);
        const m3u8FallbackUrl = this.getM3u8LiveFallbackUrl(streamUrl);

        if (currentVersion !== this.streamVersion) {
            return;
        }

        if (
            (this.player === VideoPlayer.ArtPlayer ||
                this.player === VideoPlayer.Html5Player) &&
            m3u8FallbackUrl
        ) {
            const resolvedM3u8Fallback = await this.getPlayableUrl(m3u8FallbackUrl);
            if (currentVersion !== this.streamVersion) {
                return;
            }
            this.setChannel(resolvedM3u8Fallback);
        } else {
            this.setChannel(resolvedStreamUrl);
        }

        if (this.player === VideoPlayer.VideoJs) {
            const sources: { src: string; type?: string }[] = [];

            if (m3u8FallbackUrl) {
                const resolvedM3u8Fallback = await this.getPlayableUrl(m3u8FallbackUrl);
                if (currentVersion !== this.streamVersion) {
                    return;
                }
                sources.push(this.buildVjsSource(resolvedM3u8Fallback, m3u8FallbackUrl));
            }

            sources.push(this.buildVjsSource(resolvedStreamUrl, streamUrl));
            this.vjsOptions = { sources };
        }
    }

    private getM3u8LiveFallbackUrl(streamUrl: string): string | null {
        const source = streamUrl.toLowerCase();
        if (
            !source.includes('/live/') ||
            !WebPlayerViewComponent.XTREAM_TS_SUFFIX_REGEX.test(source)
        ) {
            return null;
        }

        return streamUrl.replace(WebPlayerViewComponent.XTREAM_TS_SUFFIX_REGEX, '.m3u8');
    }

    private buildVjsSource(
        streamUrl: string,
        sourceUrlForType?: string
    ): { src: string; type?: string } {
        const sourceHint = (sourceUrlForType ?? streamUrl).toLowerCase();
        const extension = getExtensionFromUrl(sourceUrlForType ?? streamUrl);
        const isLiveLike =
            sourceHint.includes('/live/') || sourceHint.includes('/live/play/');

        // Only force MIME when confidently known. For unknown live URLs,
        // leaving type undefined allows Video.js/native tech to inspect response headers.
        let mimeType: string | undefined;
        if (extension === 'm3u' || extension === 'm3u8') {
            mimeType = 'application/x-mpegURL';
        } else if (extension === 'ts' || sourceHint.includes('/live/play/')) {
            mimeType = 'video/mp2t';
        } else if (extension === 'mp4' || sourceHint.includes('.mp4')) {
            mimeType = 'video/mp4';
        } else if (!isLiveLike) {
            // For VOD/series with opaque URLs, mp4 fallback improves compatibility.
            mimeType = 'video/mp4';
        }

        return { src: streamUrl, type: mimeType };
    }

    private async getPlayableUrl(streamUrl: string): Promise<string> {
        const electronApi = (globalThis as {
            electron?: { getStreamProxyPort?: () => Promise<number> };
        }).electron;

        if (!electronApi?.getStreamProxyPort) {
            return streamUrl;
        }

        if (!/^https?:\/\//i.test(streamUrl)) {
            return streamUrl;
        }

        try {
            const port = await electronApi.getStreamProxyPort();
            if (!port) {
                return streamUrl;
            }

            return `http://127.0.0.1:${port}/stream?url=${encodeURIComponent(streamUrl)}`;
        } catch {
            return streamUrl;
        }
    }

    setChannel(streamUrl: string) {
        this.channel = {
            url: streamUrl,
        };
    }
}
