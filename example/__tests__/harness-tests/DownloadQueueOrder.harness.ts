import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'react-native-harness';
import { DownloadManager, TrackItem } from 'react-native-nitro-player';

const createTestTrack = (id: string, songNumber: number): TrackItem => ({
  id,
  title: `Queue Order Track ${id}`,
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 180.0,
  url: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${songNumber}.mp3`,
});

const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

// Track ids that have reported download progress, so the test can tell that the
// first download is really running before it queues the others behind it.
const trackIdsWithProgress = new Set<string>();
DownloadManager.onDownloadProgress(progress => {
  trackIdsWithProgress.add(progress.trackId);
});

// Track ids in the order their downloads started
const startOrder: string[] = [];
DownloadManager.onDownloadStateChange((_downloadId, trackId, state) => {
  if (state === 'downloading' && !startOrder.includes(trackId)) {
    startOrder.push(trackId);
  }
});

// False when no progress arrives in time (no network, or an unsigned simulator
// build, where background URLSession tasks fail before transferring a byte).
const waitForProgress = async (trackId: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (!trackIdsWithProgress.has(trackId) && Date.now() < deadline) {
    await wait(100);
  }
  return trackIdsWithProgress.has(trackId);
};

const waitForStartCount = async (count: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (startOrder.length < count && Date.now() < deadline) {
    await wait(100);
  }
  return startOrder.length >= count;
};

describe('DownloadManager - queued downloads start in the order they were added', () => {
  const queuedTracks = [
    createTestTrack('queue-order-b', 1),
    createTestTrack('queue-order-c', 2),
    createTestTrack('queue-order-d', 3),
    createTestTrack('queue-order-e', 5),
    createTestTrack('queue-order-f', 6),
  ];
  const downloadIds = new Map<string, string>();
  let firstIsDownloading: boolean;

  beforeEach(async () => {
    DownloadManager.configure({
      storageLocation: 'private',
      maxConcurrentDownloads: 1,
      backgroundDownloadsEnabled: true,
      downloadArtwork: false,
      wifiOnlyDownloads: false,
    });

    await DownloadManager.cancelAllDownloads();
    await DownloadManager.deleteAllDownloads();

    // With a single slot, the first download takes it and the rest wait in the queue
    trackIdsWithProgress.clear();
    downloadIds.clear();
    const first = createTestTrack('queue-order-a', 4);
    downloadIds.set(first.id, await DownloadManager.downloadTrack(first));
    firstIsDownloading = await waitForProgress(first.id, 15000);
    if (!firstIsDownloading) return;

    startOrder.length = 0;
    for (const track of queuedTracks) {
      downloadIds.set(track.id, await DownloadManager.downloadTrack(track));
    }
  });

  afterEach(async () => {
    try {
      await DownloadManager.cancelAllDownloads();
      await DownloadManager.deleteAllDownloads();
    } catch (e) {
      console.warn('Error cleaning up downloads:', e);
    }
  });

  it('should start queued downloads first in, first out', async () => {
    if (!firstIsDownloading) {
      console.warn('No download progress within 15 seconds - skipping test');
      return;
    }

    // Free the slot over and over by cancelling whichever download holds it
    let running = 'queue-order-a';
    for (let started = 1; started <= queuedTracks.length; started++) {
      await DownloadManager.cancelDownload(downloadIds.get(running)!);
      if (!(await waitForStartCount(started, 20000))) break;
      running = startOrder[started - 1];
    }
    console.log(`[queue-order] start order: ${startOrder.join(', ')}`);

    expect(startOrder).toEqual(queuedTracks.map(track => track.id));
  });
});
