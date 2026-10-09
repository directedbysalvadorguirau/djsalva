const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const sessionDefs'));

class Element extends EventTarget {
  constructor(id = '') {
    super();
    Object.assign(this, { id, style: {}, hidden: true, currentTime: 0, duration: NaN, readyState: 0, paused: true, children: [], attributes: {}, queries: {} });
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  appendChild(child) { this.children.push(child); }
  querySelector(selector) { return this.queries[selector] ||= new Element(); }
  load() { this.loads = (this.loads || 0) + 1; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  metadata(duration) { this.duration = duration; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
}

function app() {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element(m[1])]));
  const location = { origin: 'https://djsalva.vercel.app', pathname: '/', hash: '#inicio' };
  const window = { addEventListener() {}, scrollTo() {} };
  const context = {
    window, location, navigator: {}, console, Element,
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [], createElement: () => new Element(), addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  const api = vm.runInNewContext(script + '\n;({ sessions, sessionDefs, showSession, showPortal, formatTime })', context);
  return { ...api, s: api.sessions.find(s => s.id === 'salva04'), elements };
}

test('04 uses the two requested audio files, not part 3, and all 77 visible titles', () => {
  const { s } = app();
  assert.equal(s.audioSegments.length, 2);
  assert.deepEqual(Array.from(s.audioSegments, p => p.url.split('/').pop()), ['sesion04-1.mp3', 'sesion04-2.mp3']);
  assert.match(s.vid.src, /\/audio\/sesion04\.mp4$/);
  assert.equal(s.tracks.length, 77);
  assert.equal(s.tracks.filter(t => t.segmentIndex === 0).length, 41);
  assert.equal(s.tracks.filter(t => t.segmentIndex === 1).length, 36);
  assert(s.tracks.every(t => t.unlocked));
  assert.equal(s.tracks[40].t, '47 RMX');
  assert.equal(s.tracks[41].t, 'NO TE HAGAS');
  assert.equal(s.tracks.at(-1).t, 'DRACUKEO');
  assert.equal(s.tracks.at(-1).relativeSec, 3709);
  assert(s.vid.muted && s.vid.loop);
  assert(!html.includes('sesion04-3.mp3'));
});

test('part 2 timeline derives from actual metadata, in either load order', () => {
  const { s, formatTime } = app();
  s.audioSegments[1].el.metadata(3900);
  assert(Number.isNaN(s.audioSegments[1].startAt));
  assert.match(s.tracks[41].at, /^Parte 2/);
  s.audioSegments[0].el.metadata(4000.25);
  assert.equal(s.audioSegments[1].startAt, 4000.25);
  for (const track of s.tracks) {
    assert.equal(track.sec, track.relativeSec + (track.segmentIndex ? 4000.25 : 0));
    assert.equal(track.at, formatTime(track.sec));
  }
  assert.equal(s.trackTimeEls[41].textContent, '1:06:40');
});

test('clicking a part 2 song seeks its own file and displays cumulative time', () => {
  const { s, showSession } = app();
  s.audioSegments[0].el.metadata(4000.25);
  s.audioSegments[1].el.metadata(3900);
  showSession('salva04');
  s.tracksEl.children[42].dispatchEvent(new Event('click'));
  assert.equal(s.activeAudioSegment.index, 1);
  assert.equal(s.aud.currentTime, 70);
  assert.equal(s.getCurrentTime(), 4070.25);
  assert.equal(s.currentTimeEl.textContent, '1:07:50');
  assert(s.audioSegments[0].el.paused);
});

test('prebuffer only near the boundary; ended advances, never resets the clock', async () => {
  const { s, showSession } = app();
  const [first, second] = s.audioSegments;
  first.el.metadata(4000.25);
  second.el.metadata(3900);
  showSession('salva04');
  await s.playAll();
  assert.equal(second.el.preload, 'metadata');
  first.el.currentTime = 3960;
  first.el.dispatchEvent(new Event('timeupdate'));
  assert.equal(second.el.preload, 'auto');
  first.el.paused = true;
  first.el.currentTime = 4000.25;
  first.el.dispatchEvent(new Event('ended'));
  await Promise.resolve();
  assert.equal(s.activeAudioSegment, second);
  assert.equal(second.el.paused, false);
  assert.equal(s.getCurrentTime(), 4000.25);
  assert.equal(s.currentTimeEl.textContent, '1:06:40');
  second.el.paused = true;
  second.el.dispatchEvent(new Event('ended'));
  assert.equal(s.activeAudioSegment, first);
  assert(s.audioSegments.every(part => part.el.paused));
});

test('leaving cancels deferred seeks and ignores stale ended events', () => {
  const { s, showSession, showPortal } = app();
  showSession('salva04');
  s.setRelativeTime(s.audioSegments[1], 70, true);
  showPortal(true);
  s.audioSegments[1].el.metadata(3900);
  s.audioSegments[0].el.dispatchEvent(new Event('ended'));
  assert(s.audioSegments.every(part => part.el.paused));
});

test('session 03 retains its explicit 1:25:57 offset; existing URLs are unchanged', () => {
  const { sessions } = app();
  assert.equal(sessions.find(s => s.id === 'salva03').audioSegments[1].startAt, 5157);
  assert.equal(sessions.find(s => s.id === 'classic').audioSegments.length, 1);
  assert.equal(sessions.find(s => s.id === 'ibicenca').audioSegments.length, 1);
});
