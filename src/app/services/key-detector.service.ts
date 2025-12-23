import { Injectable } from '@angular/core';
import Meyda from 'meyda';
import * as Tone from 'tone';

@Injectable({
    providedIn: 'root'
})
export class KeyDetectorService {

    constructor() { }

    // Krumhansl-Schmuckler Profiles
    private readonly MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    private readonly MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    private readonly KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    /**
     * Estimates the tuning reference (e.g. 440Hz vs 432Hz) by analyzing
     * the average deviation of significant peaks from the A440 grid.
     */
    async detectTuningReference(buffer: AudioBuffer): Promise<number> {
        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const fftSize = 4096;
        const binSize = sampleRate / fftSize;

        // Analyze chunks
        const chunksToAnalyze = 50;
        const step = Math.floor(channelData.length / chunksToAnalyze);

        let totalCentsDeviation = 0;
        let validChunks = 0;

        // Use "any" cast to avoid type issues with library definition
        (Meyda as any).audioContext = Tone.getContext().rawContext as AudioContext;

        for (let i = 0; i < chunksToAnalyze; i++) {
            const start = i * step;
            // Ensure we are inside bounds
            if (start + fftSize > channelData.length) break;

            const chunk = channelData.slice(start, start + fftSize);

            try {
                const rawSpectrum = Meyda.extract('amplitudeSpectrum', chunk as any);
                if (rawSpectrum) {
                    // Fix: Cast to array of numbers
                    const spectrum = rawSpectrum as any as number[];

                    // Find Peak Bin
                    let maxVal = -1;
                    let maxBin = -1;
                    // Ignore low freq (DC to ~100Hz) to avoid rumble? 
                    // 100Hz at 44100/4096 (~10Hz) is bin 10.
                    for (let k = 10; k < spectrum.length / 2; k++) { // Nyquist
                        if (spectrum[k] > maxVal) {
                            maxVal = spectrum[k];
                            maxBin = k;
                        }
                    }

                    if (maxVal > 0.1) { // Threshold for silence
                        const freq = maxBin * binSize;
                        // Calculate deviation from nearest A440 semitone
                        const midi = 69 + 12 * Math.log2(freq / 440);
                        const nearestMidi = Math.round(midi);
                        const deviation = (midi - nearestMidi) * 100; // in Cents

                        totalCentsDeviation += deviation;
                        validChunks++;
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        if (validChunks === 0) return 440;

        const avgDeviation = totalCentsDeviation / validChunks;
        // Calculate new reference
        // freq = 440 * 2^(cents/1200)
        const ref = 440 * Math.pow(2, avgDeviation / 1200);
        return Math.round(ref); // Round to integer Hz
    }

    async detectKey(buffer: AudioBuffer): Promise<string> {
        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const bufferSize = 4096;
        const durationToAnalyze = Math.min(30, buffer.duration);
        const startSample = Math.floor((buffer.duration / 2 - durationToAnalyze / 2) * sampleRate);
        const safeStart = Math.max(0, startSample);
        const endSample = Math.min(safeStart + durationToAnalyze * sampleRate, buffer.length);
        const hopSize = 8192;

        // Cumulative Chroma
        const totalChroma = new Float32Array(12).fill(0);
        let frames = 0;

        (Meyda as any).audioContext = Tone.getContext().rawContext as AudioContext;

        for (let i = safeStart; i < endSample - bufferSize; i += hopSize) {
            const chunk = channelData.slice(i, i + bufferSize);
            if (chunk.length < bufferSize) break;

            try {
                const features = Meyda.extract('chroma', chunk as any);
                if (features) {
                    const chroma = features as any as number[];
                    for (let k = 0; k < 12; k++) {
                        totalChroma[k] += chroma[k];
                    }
                    frames++;
                }
            } catch (e) {
                console.warn("Meyda extraction error", e);
            }
        }

        if (frames === 0) return "Unknown";

        // Normalize Chroma
        const avgChroma = Array.from(totalChroma).map(val => val / frames);

        // Correlate
        let bestCorrelation = -Infinity;
        let bestKey = "";

        // Test Major Keys
        for (let i = 0; i < 12; i++) {
            const correlation = this.correlate(avgChroma, this.rotate(this.MAJOR_PROFILE, i));
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestKey = `${this.KEYS[i]} Major`;
            }
        }

        // Test Minor Keys
        for (let i = 0; i < 12; i++) {
            const correlation = this.correlate(avgChroma, this.rotate(this.MINOR_PROFILE, i));
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestKey = `${this.KEYS[i]} Minor`;
            }
        }

        return bestKey;
    }

    private correlate(chroma: number[], profile: number[]): number {
        let sumXx = 0;
        let sumYy = 0;
        let sumXy = 0;

        const meanX = chroma.reduce((a, b) => a + b, 0) / 12;
        const meanY = profile.reduce((a, b) => a + b, 0) / 12;

        for (let i = 0; i < 12; i++) {
            const x = chroma[i] - meanX;
            const y = profile[i] - meanY;
            sumXx += x * x;
            sumYy += y * y;
            sumXy += x * y;
        }

        return sumXy / Math.sqrt(sumXx * sumYy);
    }

    private rotate(arr: number[], n: number): number[] {
        const len = arr.length;
        const rotated = new Array(len);
        for (let i = 0; i < len; i++) {
            rotated[i] = arr[(i - n + len) % len];
        }
        return rotated;
    }
}
