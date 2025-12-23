import { Injectable, signal } from '@angular/core';
import * as Tone from 'tone';

@Injectable({
    providedIn: 'root'
})
export class AudioService {
    private player: Tone.Player | null = null;
    private pitchShift: Tone.PitchShift | null = null;

    // State
    isPlaying = signal<boolean>(false);
    isLoaded = signal<boolean>(false);
    duration = signal<number>(0);
    currentTime = signal<number>(0);
    isBypassed = signal<boolean>(false);
    preserveTempo = signal<boolean>(false); // Default to Varispeed (High Quality)

    private currentSemitones = 0;

    // Time Tracking (Manual)
    private startTimestamp = 0;
    private pausedAt = 0; // Where we are in the file (seconds)
    private playbackRate = 1;

    public buffer: Tone.ToneAudioBuffer | null = null;

    constructor() { }

    async loadAudio(file: File): Promise<void> {
        await Tone.start();
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = Tone.getContext().rawContext;
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        this.buffer = new Tone.ToneAudioBuffer(audioBuffer);

        // Reset
        this.pausedAt = 0;
        this.currentTime.set(0);

        this.setupPlayer();

        this.duration.set(this.buffer.duration);
        this.isLoaded.set(true);

        // Sync current time
        setInterval(() => {
            if (this.isPlaying()) {
                const now = Tone.now();
                const elapsedRealTime = now - this.startTimestamp;
                // effective advanced time in file
                const advancedTime = elapsedRealTime * this.playbackRate;
                const currentPos = this.pausedAt + advancedTime;

                // Loop or Clamp? Player loop is false by default.
                if (currentPos >= this.duration()) {
                    this.pause();
                    this.seek(0);
                } else {
                    this.currentTime.set(currentPos);
                }
            }
        }, 50); // 20fps update
    }

    private setupPlayer() {
        this.pitchShift?.dispose();
        this.player?.dispose();

        this.pitchShift = new Tone.PitchShift({
            pitch: 0,
            windowSize: 0.1,
            delayTime: 0,
            feedback: 0
        }).toDestination();

        this.player = new Tone.Player(this.buffer!);
        this.updatePitchProcessing();
    }

    play() {
        if (!this.player) return;
        if (this.isPlaying()) return;

        this.startTimestamp = Tone.now();
        // Start player at current offset
        // Standard Player start: start(when, offset, duration)
        this.player.start(0, this.pausedAt);
        this.isPlaying.set(true);
    }

    pause() {
        if (!this.player) return;
        if (!this.isPlaying()) return;

        this.player.stop();

        // Calculate new pausedAt
        const now = Tone.now();
        const playedFor = (now - this.startTimestamp) * this.playbackRate;
        this.pausedAt += playedFor;

        this.isPlaying.set(false);
        this.currentTime.set(this.pausedAt);
    }

    seek(time: number) {
        if (!this.player) return;

        // Clamp
        time = Math.max(0, Math.min(time, this.duration()));

        const wasPlaying = this.isPlaying();
        if (wasPlaying) {
            this.player.stop();
        }

        this.pausedAt = time;
        this.currentTime.set(time);

        if (wasPlaying) {
            this.startTimestamp = Tone.now();
            this.player.start(0, this.pausedAt);
        }
    }

    setPitchShift(semitones: number) {
        this.currentSemitones = semitones;
        this.updatePitchProcessing();
    }

    setPreserveTempo(preserve: boolean) {
        this.preserveTempo.set(preserve);
        this.updatePitchProcessing();
    }

    toggleBypass() {
        this.isBypassed.set(!this.isBypassed());
        this.updatePitchProcessing();
    }

    private updatePitchProcessing() {
        if (!this.player || !this.pitchShift) return;

        const semitones = this.isBypassed() ? 0 : this.currentSemitones;
        const isGranular = this.preserveTempo();

        // Checkpoint time if playing
        if (this.isPlaying()) {
            const now = Tone.now();
            this.pausedAt += (now - this.startTimestamp) * this.playbackRate;
            this.startTimestamp = now;
        }

        // 1. Handle Playback Rate (Varispeed)
        let newRate = 1;
        if (!isGranular && !this.isBypassed()) {
            newRate = Math.pow(2, semitones / 12);
        }

        this.playbackRate = newRate;
        this.player.playbackRate = newRate;

        // 2. Handle Routing and PitchShift Node
        this.player.disconnect();

        if (isGranular && !this.isBypassed()) {
            this.pitchShift.pitch = semitones;
            this.player.connect(this.pitchShift);
        } else {
            this.player.toDestination();
        }
    }

    // Calculate semitones from Hz
    calculateSemitones(baseHz: number, targetHz: number): number {
        return 12 * Math.log2(targetHz / baseHz);
    }

    async download(targetSemitones: number): Promise<void> {
        if (!this.buffer) return;

        // Offline rendering
        const duration = this.buffer.duration;
        const offlineContext = new Tone.OfflineContext(2, duration, Tone.getContext().sampleRate);

        // Recreate graph in offline context
        const offlineBuffer = this.buffer.get();
        // ToneAudioBuffer.get() returns AudioBuffer, but we need to load it into offline context
        // Actually Tone.Offline renders a callback.

        await Tone.Offline(async () => {
            const pitchShift = new Tone.PitchShift(targetSemitones).toDestination();
            const player = new Tone.Player(this.buffer!).connect(pitchShift);
            player.start();
        }, duration).then((renderedBuffer) => {
            // Tone.Offline returns ToneAudioBuffer or AudioBuffer (Tone 14 returns AudioBuffer usually)
            // If renderedBuffer is ToneAudioBuffer (it might be), use .get()
            const buffer = renderedBuffer instanceof Tone.ToneAudioBuffer ? renderedBuffer.get() : renderedBuffer;
            this.bufferToWave(buffer as AudioBuffer, 'shifted_audio.wav');
        });
    }

    // Helper to convert AudioBuffer to WAV and trigger download
    private bufferToWave(abuffer: AudioBuffer, name: string) {
        const numOfChan = abuffer.numberOfChannels;
        const length = abuffer.length * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let i;
        let sample;
        let offset = 0;
        let pos = 0;

        // write WAVE header
        setUint32(0x46464952);                         // "RIFF"
        setUint32(length - 8);                         // file length - 8
        setUint32(0x45564157);                         // "WAVE"

        setUint32(0x20746d66);                         // "fmt " chunk
        setUint32(16);                                 // length = 16
        setUint16(1);                                  // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2);                      // block-align
        setUint16(16);                                 // 16-bit (hardcoded in this loop)

        setUint32(0x61746164);                         // "data" - chunk
        setUint32(length - pos - 4);                   // chunk length

        // write interleaved data
        for (i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while (pos < abuffer.length) {
            for (i = 0; i < numOfChan; i++) {             // interleave channels
                sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
                view.setInt16(44 + offset, sample, true);          // write 16-bit sample
                offset += 2;
            }
            pos++;
        }

        // create Blob
        const blob = new Blob([buffer], { type: "audio/wav" });

        // trigger download
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        document.body.appendChild(anchor);
        anchor.style.display = "none";
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);

        function setUint16(data: any) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data: any) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }
}
