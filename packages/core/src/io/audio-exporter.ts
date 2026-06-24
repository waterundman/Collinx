export interface WAVExportOptions {
  sampleRate?: number;
  bitDepth?: 16 | 24 | 32;
  channels?: 1 | 2;
}

function writeString(buffer: number[], str: string): void {
  for (let i = 0; i < str.length; i++) {
    buffer.push(str.charCodeAt(i));
  }
}

function writeUint32le(buffer: number[], value: number): void {
  buffer.push(value & 0xff);
  buffer.push((value >> 8) & 0xff);
  buffer.push((value >> 16) & 0xff);
  buffer.push((value >> 24) & 0xff);
}

function writeUint16le(buffer: number[], value: number): void {
  buffer.push(value & 0xff);
  buffer.push((value >> 8) & 0xff);
}

function floatToPCM(sample: number, bitDepth: number): number[] {
  const maxVal = Math.pow(2, bitDepth - 1) - 1;
  const minVal = -Math.pow(2, bitDepth - 1);
  const clamped = Math.max(-1, Math.min(1, sample));
  const intVal = clamped >= 0
    ? Math.round(clamped * maxVal)
    : Math.round(clamped * Math.abs(minVal));
  const unsigned = (intVal >>> 0);

  const bytes: number[] = [];
  const byteCount = Math.ceil(bitDepth / 8);
  for (let i = 0; i < byteCount; i++) {
    bytes.push((unsigned >> (i * 8)) & 0xff);
  }
  return bytes;
}

export class AudioExporter {
  static encodeWAV(samples: Float32Array[], options?: WAVExportOptions): ArrayBuffer {
    const sampleRate = options?.sampleRate ?? 44100;
    const bitDepth = options?.bitDepth ?? 16;
    const channels = options?.channels ?? 2;

    if (samples.length !== channels) {
      throw new Error(
        `Samples channels (${samples.length}) do not match options.channels (${channels})`
      );
    }

    const numSamples = samples[0].length;
    for (let ch = 1; ch < channels; ch++) {
      if (samples[ch].length !== numSamples) {
        throw new Error(
          `Channel ${ch} sample count (${samples[ch].length}) does not match channel 0 (${numSamples})`
        );
      }
    }

    const bytesPerSample = Math.ceil(bitDepth / 8);
    const dataLength = numSamples * channels * bytesPerSample;

    const header = AudioExporter.createWAVHeader(dataLength, options);
    const headerArr = new Uint8Array(header);

    const result = new Uint8Array(headerArr.length + dataLength);
    result.set(headerArr, 0);

    let offset = headerArr.length;

    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const pcmBytes = floatToPCM(samples[ch][i], bitDepth);
        for (const b of pcmBytes) {
          result[offset++] = b;
        }
      }
    }

    return (result.buffer as ArrayBuffer).slice(result.byteOffset, result.byteOffset + result.byteLength);
  }

  static createWAVHeader(dataLength: number, options?: WAVExportOptions): ArrayBuffer {
    const sampleRate = options?.sampleRate ?? 44100;
    const bitDepth = options?.bitDepth ?? 16;
    const channels = options?.channels ?? 2;

    const bytesPerSample = Math.ceil(bitDepth / 8);
    const byteRate = sampleRate * channels * bytesPerSample;
    const blockAlign = channels * bytesPerSample;
    const fmtChunkSize = 16;
    const audioFormat = bitDepth === 32 ? 3 : 1;

    const buffer: number[] = [];

    writeString(buffer, "RIFF");
    writeUint32le(buffer, 36 + dataLength);
    writeString(buffer, "WAVE");

    writeString(buffer, "fmt ");
    writeUint32le(buffer, fmtChunkSize);
    writeUint16le(buffer, audioFormat);
    writeUint16le(buffer, channels);
    writeUint32le(buffer, sampleRate);
    writeUint32le(buffer, byteRate);
    writeUint16le(buffer, blockAlign);
    writeUint16le(buffer, bitDepth);

    writeString(buffer, "data");
    writeUint32le(buffer, dataLength);

    const result2 = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      result2[i] = buffer[i];
    }
    return (result2.buffer as ArrayBuffer).slice(result2.byteOffset, result2.byteOffset + result2.byteLength);
  }

  static async toFile(
    samples: Float32Array[],
    filePath: string,
    options?: WAVExportOptions
  ): Promise<void> {
    const buffer = AudioExporter.encodeWAV(samples, options);
    const fs = await import("fs/promises");
    const uint8 = new Uint8Array(buffer);
    await fs.writeFile(filePath, uint8);
  }
}
