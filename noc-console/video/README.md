# Local video (go2rtc)

`VideoSlot` plays a camera's go2rtc WebRTC stream when the camera has a `streamUrl`, and keeps the
striped placeholder when it doesn't (`docs/API-CONTRACT.md` §7). To try it without real cameras, run a
local go2rtc that plays one video file, looped, as every seeded camera.

You need two binaries, neither of which goes in the repo:

- **go2rtc** 1.9.x, from <https://github.com/AlexxIT/go2rtc/releases> (`go2rtc_linux_amd64` etc.)
- **ffmpeg**, on `PATH` or anywhere (set `NOC_FFMPEG` to its path)

## 1. A test clip

Any H.264 `.mp4` works. Or make one from ffmpeg's built-in test pattern (20 s, 720p, keyframe every 2 s):

```bash
ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=25" -t 20 \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -g 50 -an /tmp/cam.mp4
```

## 2. go2rtc

```bash
NOC_VIDEO_FILE=/tmp/cam.mp4 NOC_FFMPEG=$(which ffmpeg) go2rtc -config video/go2rtc.yaml
```

`video/go2rtc.yaml` defines `cam<id>` and `cam<id>_sub` for every seeded camera with a signal (offline
camera 19 has none, so it keeps the placeholder), plus `slow`: the same file re-encoded at 2 fps, under
the 3 fps "degraded" threshold. go2rtc's own UI is at <http://localhost:1984>.

## 3. The console

```bash
VITE_GO2RTC_URL=http://localhost:1984 npm run dev                   # in-browser mock
NOC_GO2RTC_URL=http://localhost:1984 npm run stub                   # or: over http, stub side
npm run dev:http                                                    #     and the app
```

Without the variable, no camera gets a stream URL and everything looks exactly as before.

## Player states

`useGo2rtcStream` reads decoded frames from the WebRTC stats every 500 ms
(`src/domain/video.ts#classifyPlayer`):

| State | When | Shown |
|---|---|---|
| `connecting` | handshake running, no frame yet | "Reconnecting…", greyed |
| `live` | frames arriving, ≥ 3 fps, no gap over 900 ms | the picture, detection boxes, latency |
| `degraded` | under 3 fps, or a frame gap over 900 ms | "Degraded", greyed |
| `lost` | no frame for 5 s (or none within 10 s of connecting), or the connection failed | "Paused · offline"; retries after 3 s |

To see each one: stop go2rtc (→ `lost`, then retries), start it again (→ `live`). For `degraded`, point
`cam07` at the `slow` source in a copy of the config.
