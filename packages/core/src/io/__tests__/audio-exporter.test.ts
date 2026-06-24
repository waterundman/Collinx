import { describe, it, expect } from "vitest";
import { AudioExporter } from "../audio-exporter";

describe("AudioExporter", () => {
  describe("createWAVHeader", () => {
    it("should create a valid WAV header", () => {
      const header = AudioExporter.createWAVHeader(1000);
      const view = new DataView(header);

      const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3)
      );
      expect(riff).toBe("RIFF");

      const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11)
      );
      expect(wave).toBe("WAVE");

      const fmt = String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15)
      );
      expect(fmt).toBe("fmt ");

      const data = String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39)
      );
      expect(data).toBe("data");
    });

    it("should set correct sample rate", () => {
      const header = AudioExporter.createWAVHeader(1000, { sampleRate: 48000 });
      const view = new DataView(header);
      expect(view.getUint32(24, true)).toBe(48000);
    });

    it("should set correct bit depth", () => {
      const header = AudioExporter.createWAVHeader(1000, { bitDepth: 24 });
      const view = new DataView(header);
      expect(view.getUint16(34, true)).toBe(24);
    });

    it("should set correct channels", () => {
      const header = AudioExporter.createWAVHeader(1000, { channels: 2 });
      const view = new DataView(header);
      expect(view.getUint16(22, true)).toBe(2);
    });

    it("should compute correct data length in header", () => {
      const dataLen = 44100;
      const header = AudioExporter.createWAVHeader(dataLen);
      const view = new DataView(header);
      expect(view.getUint32(4, true)).toBe(36 + dataLen);
      expect(view.getUint32(40, true)).toBe(dataLen);
    });

    it("should set format tag for 16-bit PCM", () => {
      const header = AudioExporter.createWAVHeader(1000, { bitDepth: 16 });
      const view = new DataView(header);
      expect(view.getUint16(20, true)).toBe(1);
    });

    it("should set format tag for 32-bit IEEE float", () => {
      const header = AudioExporter.createWAVHeader(1000, { bitDepth: 32 });
      const view = new DataView(header);
      expect(view.getUint16(20, true)).toBe(3);
    });

    it("should compute correct byte rate", () => {
      const header = AudioExporter.createWAVHeader(1000, { sampleRate: 44100, channels: 2, bitDepth: 16 });
      const view = new DataView(header);
      expect(view.getUint32(28, true)).toBe(44100 * 2 * 2);
    });

    it("should compute correct block align", () => {
      const header = AudioExporter.createWAVHeader(1000, { channels: 2, bitDepth: 24 });
      const view = new DataView(header);
      expect(view.getUint16(32, true)).toBe(2 * 3);
    });

    it("should use default values", () => {
      const header = AudioExporter.createWAVHeader(1000);
      const view = new DataView(header);
      expect(view.getUint32(24, true)).toBe(44100);
      expect(view.getUint16(22, true)).toBe(2);
      expect(view.getUint16(34, true)).toBe(16);
    });
  });

  describe("encodeWAV", () => {
    it("should encode mono 16-bit WAV", () => {
      const samples = [new Float32Array([0, 0.5, -0.5, 1, -1])];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1, bitDepth: 16, sampleRate: 44100 });
      expect(buffer.byteLength).toBeGreaterThan(44);

      const view = new DataView(buffer);
      const dataLen = view.getUint32(40, true);
      expect(dataLen).toBe(5 * 2);
    });

    it("should encode stereo 16-bit WAV", () => {
      const left = new Float32Array([0, 0.5, -0.5]);
      const right = new Float32Array([0, -0.5, 0.5]);
      const buffer = AudioExporter.encodeWAV([left, right], { channels: 2, bitDepth: 16, sampleRate: 44100 });
      expect(buffer.byteLength).toBeGreaterThan(44);

      const view = new DataView(buffer);
      const dataLen = view.getUint32(40, true);
      expect(dataLen).toBe(3 * 2 * 2);
    });

    it("should encode 24-bit WAV", () => {
      const samples = [new Float32Array([0, 0.5, -0.5])];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1, bitDepth: 24, sampleRate: 44100 });
      const view = new DataView(buffer);
      const dataLen = view.getUint32(40, true);
      expect(dataLen).toBe(3 * 3);
    });

    it("should encode 32-bit WAV", () => {
      const samples = [new Float32Array([0, 0.5])];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1, bitDepth: 32, sampleRate: 44100 });
      const view = new DataView(buffer);
      const dataLen = view.getUint32(40, true);
      expect(dataLen).toBe(2 * 4);
    });

    it("should throw if channel count mismatch", () => {
      const samples = [new Float32Array([0, 1]), new Float32Array([0, 1])];
      expect(() =>
        AudioExporter.encodeWAV(samples, { channels: 1 })
      ).toThrow(/channels/);
    });

    it("should throw if sample lengths mismatch", () => {
      const samples = [new Float32Array([0, 1]), new Float32Array([0])];
      expect(() =>
        AudioExporter.encodeWAV(samples, { channels: 2 })
      ).toThrow(/sample count/);
    });

    it("should clamp samples to [-1, 1]", () => {
      const samples = [new Float32Array([2.0, -2.0, 0])];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1, bitDepth: 16, sampleRate: 44100 });

      const view = new DataView(buffer);
      const firstSample = view.getInt16(44, true);
      const secondSample = view.getInt16(46, true);
      expect(firstSample).toBe(32767);
      expect(secondSample).toBe(-32768);
    });

    it("should produce RIFF header as first 4 bytes", () => {
      const samples = [new Float32Array([0])];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1 });
      const view = new DataView(buffer);
      const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      expect(magic).toBe("RIFF");
    });

    it("should handle empty samples", () => {
      const samples = [new Float32Array(0)];
      const buffer = AudioExporter.encodeWAV(samples, { channels: 1 });
      expect(buffer.byteLength).toBe(44);
    });
  });
});
