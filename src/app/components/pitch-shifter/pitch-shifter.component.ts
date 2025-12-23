import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Play, Pause, Upload, Music, Download, RefreshCcw } from 'lucide-angular';
import { AudioService } from '../../services/audio.service';
import { KeyDetectorService } from '../../services/key-detector.service';

@Component({
    selector: 'app-pitch-shifter',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    templateUrl: './pitch-shifter.component.html',
    styleUrls: ['./pitch-shifter.component.scss']
})
export class PitchShifterComponent {
    audioService = inject(AudioService);
    keyDetector = inject(KeyDetectorService);

    // UI State
    mode = signal<'hz' | 'key'>('hz');

    // Hz Mode Inputs
    baseHz = signal<number>(440);
    targetHz = signal<number>(432);

    // Key Mode Inputs
    detectedKey = signal<string>('Unknown');
    targetKey = signal<string>('C Major');

    // Scale Data
    readonly KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    readonly SCALES = ['Major', 'Minor'];
    availableKeys: string[] = [];

    // Icons
    readonly Play = Play;
    readonly Pause = Pause;
    readonly Upload = Upload;
    readonly Music = Music;
    readonly Download = Download;
    readonly RefreshCcw = RefreshCcw;

    constructor() {
        this.generateAvailableKeys();

        // Effect to update pitch shift when Hz values change (if in Hz mode)
        effect(() => {
            if (this.mode() === 'hz') {
                // Hz mode defaults to High Quality (Varispeed) usually, but we let user choose
                // For now, let's not force it, but user might want Varispeed for Hz
                const diff = this.audioService.calculateSemitones(this.baseHz(), this.targetHz());
                this.audioService.setPitchShift(diff);
            }
        });

        // Effect to update pitch shift when KEYS change
        effect(() => {
            if (this.mode() === 'key') {
                const semitones = this.calculateKeyShift(this.detectedKey(), this.targetKey());
                this.audioService.setPitchShift(semitones);
            }
        });

        // Initial setup
        effect(() => {
            // If Hz mode, default to Varispeed (preserveTempo = false) for better quality?
            // User complained about quality. Varispeed is best.
            // Let's just expose the toggle.
        });
    }

    togglePreserveTempo() {
        this.audioService.setPreserveTempo(!this.audioService.preserveTempo());
    }

    generateAvailableKeys() {
        this.availableKeys = [];
        for (const key of this.KEYS) {
            for (const scale of this.SCALES) {
                this.availableKeys.push(`${key} ${scale}`);
            }
        }
    }

    async onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            await this.handleFile(input.files[0]);
        }
    }

    onDragOver(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    async onDrop(event: DragEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (event.dataTransfer && event.dataTransfer.files.length > 0) {
            await this.handleFile(event.dataTransfer.files[0]);
        }
    }

    private async handleFile(file: File) {
        await this.audioService.loadAudio(file);

        // Auto-detect key
        if (this.audioService.buffer) {
            try {
                // Cast to AudioBuffer safely
                const buffer = this.audioService.buffer.get();
                if (buffer instanceof AudioBuffer) {
                    // Detect Key
                    const key = await this.keyDetector.detectKey(buffer);
                    if (key && key !== 'Unknown') {
                        this.detectedKey.set(key);
                        this.targetKey.set(key);
                    }

                    // Detect Reference Pitch
                    const refPitch = await this.keyDetector.detectTuningReference(buffer);
                    if (refPitch) {
                        this.baseHz.set(refPitch);
                    }
                }
            } catch (e) {
                console.error("Key detection failed", e);
            }
        }
    }

    async autoDetectHz() {
        if (!this.audioService.buffer) return;
        const buffer = this.audioService.buffer.get();
        if (buffer instanceof AudioBuffer) {
            const refPitch = await this.keyDetector.detectTuningReference(buffer);
            this.baseHz.set(refPitch);
        }
    }

    seek(event: Event) {
        const input = event.target as HTMLInputElement;
        const time = parseFloat(input.value);
        this.audioService.seek(time);
    }

    togglePlay() {
        if (this.audioService.isPlaying()) {
            this.audioService.pause();
        } else {
            this.audioService.play();
        }
    }

    setMode(m: 'hz' | 'key') {
        this.mode.set(m);
        // Reset pitch shift logic based on new mode
        if (m === 'hz') {
            const diff = this.audioService.calculateSemitones(this.baseHz(), this.targetHz());
            this.audioService.setPitchShift(diff);
        } else {
            const diff = this.calculateKeyShift(this.detectedKey(), this.targetKey());
            this.audioService.setPitchShift(diff);
        }
    }

    calculateKeyShift(fromKey: string, toKey: string): number {
        // Parse "C Major" -> "C"
        if (!fromKey || !toKey) return 0;
        const fromRoot = fromKey.split(' ')[0];
        const toRoot = toKey.split(' ')[0];

        const fromIndex = this.KEYS.indexOf(fromRoot);
        const toIndex = this.KEYS.indexOf(toRoot);

        if (fromIndex === -1 || toIndex === -1) return 0;

        let diff = toIndex - fromIndex;

        // Find shortest path
        if (diff > 6) diff -= 12;
        if (diff < -6) diff += 12;

        return diff;
    }

    async download() {
        let targetSt = 0;
        if (this.mode() === 'hz') {
            targetSt = this.audioService.calculateSemitones(this.baseHz(), this.targetHz());
        } else {
            targetSt = this.calculateKeyShift(this.detectedKey(), this.targetKey());
        }
        await this.audioService.download(targetSt);
    }
}
