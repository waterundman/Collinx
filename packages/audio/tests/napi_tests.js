/**
 * N-API binding tests for Collinx VST3 Host.
 *
 * These tests verify the N-API bindings work correctly.
 * They require a built addon and Node.js environment.
 */

const path = require('path');
const assert = require('assert');

// Load the native addon
const addonPath = path.join(__dirname, '..', 'build', 'Release', 'vst3-host-addon');
let addon;

try {
    addon = require(addonPath);
} catch (err) {
    console.error('Failed to load native addon:', err.message);
    console.error('Build the addon first: npm run build:native');
    process.exit(1);
}

describe('VST3 Host Addon', () => {
    describe('Module exports', () => {
        it('should export PluginManagerBridge class', () => {
            assert.strictEqual(typeof addon.PluginManagerBridge, 'function');
        });

        it('should export AudioProcessorBridge class', () => {
            assert.strictEqual(typeof addon.AudioProcessorBridge, 'function');
        });

        it('should export version info', () => {
            assert.strictEqual(addon.version, '1.2.0');
            assert.strictEqual(addon.engineType, 'VST3');
        });

        it('should export utility functions', () => {
            assert.strictEqual(typeof addon.getDefaultScanPaths, 'function');
            assert.strictEqual(typeof addon.isVst3File, 'function');
        });
    });

    describe('Utility functions', () => {
        it('should get default scan paths', () => {
            const paths = addon.getDefaultScanPaths();
            assert(Array.isArray(paths));
            assert(paths.length > 0);
            paths.forEach(p => assert.strictEqual(typeof p, 'string'));
        });

        it('should detect VST3 file extension', () => {
            assert.strictEqual(addon.isVst3File('test.vst3'), true);
            assert.strictEqual(addon.isVst3File('test.dll'), false);
            assert.strictEqual(addon.isVst3File('test.vst'), false);
        });

        it('should throw on invalid arguments', () => {
            assert.throws(() => addon.isVst3File(123), TypeError);
            assert.throws(() => addon.isVst3File(), TypeError);
        });
    });

    describe('PluginManagerBridge', () => {
        let manager;

        beforeEach(() => {
            manager = new addon.PluginManagerBridge();
        });

        afterEach(() => {
            if (manager.isInitialized()) {
                manager.shutdown();
            }
        });

        it('should create instance', () => {
            assert(manager instanceof addon.PluginManagerBridge);
        });

        it('should initialize successfully', () => {
            const result = manager.initialize();
            assert.strictEqual(result, true);
            assert.strictEqual(manager.isInitialized(), true);
        });

        it('should shutdown successfully', () => {
            manager.initialize();
            manager.shutdown();
            assert.strictEqual(manager.isInitialized(), false);
        });

        it('should get default scan paths', () => {
            manager.initialize();
            const paths = manager.getDefaultScanPaths();
            assert(Array.isArray(paths));
            assert(paths.length > 0);
        });

        it('should scan default paths (async)', async () => {
            manager.initialize();
            const plugins = await manager.scanDefaultPaths();
            assert(Array.isArray(plugins));
            // Note: actual plugins depend on system configuration
        });

        it('should scan specific directory (async)', async () => {
            manager.initialize();
            const testDir = path.join(__dirname, 'fixtures');
            try {
                const plugins = await manager.scanDirectory(testDir);
                assert(Array.isArray(plugins));
            } catch (err) {
                // Directory might not exist in test environment
                assert(err.message.includes('not found') || err.message.includes('No such'));
            }
        });

        it('should get cached results', () => {
            manager.initialize();
            const cached = manager.getCachedResults();
            assert(Array.isArray(cached));
        });

        it('should clear cache', () => {
            manager.initialize();
            manager.clearCache();
            const cached = manager.getCachedResults();
            assert.strictEqual(cached.length, 0);
        });

        it('should report 0 plugins initially', () => {
            manager.initialize();
            assert.strictEqual(manager.getNumPlugins(), 0);
        });

        it('should report plugin not loaded', () => {
            manager.initialize();
            assert.strictEqual(manager.isPluginLoaded(0), false);
            assert.strictEqual(manager.isPluginLoaded(-1), false);
        });

        it('should get all plugins info as empty array', () => {
            manager.initialize();
            const info = manager.getAllPluginsInfo();
            assert(Array.isArray(info));
            assert.strictEqual(info.length, 0);
        });
    });

    describe('AudioProcessorBridge', () => {
        let manager;
        let processor;

        beforeEach(() => {
            manager = new addon.PluginManagerBridge();
            manager.initialize();
            processor = new addon.AudioProcessorBridge(manager);
        });

        afterEach(() => {
            if (processor) {
                processor.release();
            }
            if (manager) {
                manager.shutdown();
            }
        });

        it('should create instance', () => {
            assert(processor instanceof addon.AudioProcessorBridge);
        });

        it('should prepare successfully', () => {
            processor.prepare(44100, 512, 2);
            // No error thrown = success
        });

        it('should release successfully', () => {
            processor.prepare(44100, 512, 2);
            processor.release();
            // No error thrown = success
        });

        it('should report empty chain initially', () => {
            processor.prepare(44100, 512, 2);
            assert.strictEqual(processor.getNumPlugins(), 0);
            assert.strictEqual(processor.isEmpty(), true);
        });

        it('should get plugin names as empty array', () => {
            processor.prepare(44100, 512, 2);
            const names = processor.getPluginNames();
            assert(Array.isArray(names));
            assert.strictEqual(names.length, 0);
        });

        it('should handle bypass state', () => {
            processor.prepare(44100, 512, 2);
            assert.strictEqual(processor.isChainBypassed(), false);
            processor.setChainBypassed(true);
            assert.strictEqual(processor.isChainBypassed(), true);
            processor.setChainBypassed(false);
            assert.strictEqual(processor.isChainBypassed(), false);
        });

        it('should process audio buffer (passthrough)', () => {
            processor.prepare(44100, 512, 2);

            // Create a simple stereo buffer (2 channels, 4 samples)
            const inputBuffer = new Float32Array([
                0.1, 0.2,  // L0, R0
                0.3, 0.4,  // L1, R1
                0.5, 0.6,  // L2, R2
                0.7, 0.8   // L3, R3
            ]);

            const output = processor.process(inputBuffer, 2, 4);

            // With no plugins, output should equal input
            assert(output instanceof Float32Array);
            assert.strictEqual(output.length, inputBuffer.length);
            for (let i = 0; i < inputBuffer.length; i++) {
                assert.strictEqual(output[i], inputBuffer[i]);
            }
        });

        it('should process audio buffer with MIDI', () => {
            processor.prepare(44100, 512, 2);

            const inputBuffer = new Float32Array(256 * 2).fill(0);
            const midiData = [
                { status: 0x90, data1: 60, data2: 100, timestamp: 0 }  // Note On C4
            ];

            const output = processor.process(inputBuffer, 2, 256, midiData);
            assert(output instanceof Float32Array);
            assert.strictEqual(output.length, inputBuffer.length);
        });

        it('should throw if not prepared', () => {
            const inputBuffer = new Float32Array(8);
            assert.throws(() => {
                processor.process(inputBuffer, 2, 4);
            }, /not prepared/);
        });

        it('should report no active plugins', () => {
            processor.prepare(44100, 512, 2);
            assert.strictEqual(processor.isAnyPluginActive(), false);
        });
    });

    describe('Plugin description format', () => {
        it('should have correct plugin description structure', async () => {
            const manager = new addon.PluginManagerBridge();
            manager.initialize();

            // Get scan paths and scan
            const plugins = await manager.scanDefaultPaths();

            if (plugins.length > 0) {
                const plugin = plugins[0];
                assert.strictEqual(typeof plugin.name, 'string');
                assert.strictEqual(typeof plugin.identifier, 'string');
                assert.strictEqual(typeof plugin.manufacturerName, 'string');
                assert.strictEqual(typeof plugin.version, 'string');
                assert.strictEqual(typeof plugin.category, 'string');
                assert.strictEqual(typeof plugin.isInstrument, 'boolean');
                assert.strictEqual(typeof plugin.numInputChannels, 'number');
                assert.strictEqual(typeof plugin.numOutputChannels, 'number');
                assert.strictEqual(typeof plugin.pluginFormatName, 'string');
                assert.strictEqual(typeof plugin.fileOrIdentifier, 'string');
            }

            manager.shutdown();
        });
    });
});
