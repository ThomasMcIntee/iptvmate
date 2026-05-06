import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from 'services';
import { Channel } from 'shared-interfaces';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let dataService: DataService;

    const TEST_CHANNEL: Channel = {
        id: '1234',
        url: 'http://test.ts',
        name: 'Test channel',
        group: {
            title: 'News group',
        },
        tvg: {
            id: 'tvg-1',
            name: 'Test TVG',
            url: '',
            logo: '',
            rec: '',
        },
        http: {
            referrer: '',
            'user-agent': 'localhost',
            origin: '',
        },
        radio: 'false',
    };

    beforeEach(waitForAsync(() => {
        const dataServiceMock = {
            sendIpcEvent: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
            providers: [{ provide: DataService, useValue: dataServiceMock }],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        dataService = TestBed.inject(DataService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call play channel function after input changes', () => {
        jest.spyOn(component, 'playChannel');
        jest.spyOn(global.console, 'error').mockImplementation(() => {
            /* empty */
        });
        component.ngOnChanges({
            channel: new SimpleChange(null, TEST_CHANNEL, true),
        });
        fixture.detectChanges();

        expect(component.playChannel).toHaveBeenCalledWith(TEST_CHANNEL);
    });

    it('should use Hls for proxied m3u8 urls', () => {
        const proxiedM3u8 =
            'http://127.0.0.1:50339/stream?url=' +
            encodeURIComponent('http://provider.example/live/user/pass/12345.m3u8');

        const playNativeSpy = jest
            .spyOn(component as any, 'playNative')
            .mockImplementation(() => undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            url: proxiedM3u8,
        });

        expect(playNativeSpy).toHaveBeenCalledWith(
            proxiedM3u8,
            'application/x-mpegURL'
        );
    });

    it('should use native mp4 playback for proxied mp4 urls', () => {
        const proxiedMp4 =
            'http://127.0.0.1:50339/stream?url=' +
            encodeURIComponent('http://provider.example/movie/user/pass/777.mp4');

        const playNativeSpy = jest
            .spyOn(component as any, 'playNative')
            .mockImplementation(() => undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            url: proxiedMp4,
        });

        expect(playNativeSpy).toHaveBeenCalledWith(proxiedMp4, 'video/mp4');
    });
});
