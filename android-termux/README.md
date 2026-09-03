# Android/Termux Adreno acceleration

This optional setup runs PrivateLLMLens with either Ollama or a native llama.cpp server accelerated by Qualcomm OpenCL. It is not required for desktop, GitHub Pages or browser-WebGPU use.

The setup was developed on a Samsung Galaxy Z Fold 8 (`SM-F971B`, Snapdragon SM8850, Adreno 840, Android 17). Drivers, accessible memory, thermals and safe contexts vary on other devices.

## Tested Fold 8 results

| Profile | Quantisation | Context | Prompt | Generation |
| --- | --- | ---: | ---: | ---: |
| Qwen3 4B | Q4_K_M | 32K | 287 tok/s | 19.8 tok/s |
| Mistral 7B | Q4_K_M | 16K | 147 tok/s | 13.2 tok/s |
| DeepSeek-R1/Qwen3 8B | Q4_K_M | 8K | 141 tok/s | 11.5 tok/s |
| Gemma 4 E4B | Q4_0 | 8K | 203 tok/s | 17.7 tok/s |

All measurements used full GPU offload and Q8 KV cache. Gemma was tested as text-only.

## 1. Build llama.cpp

Install Termux from F-Droid or its official GitHub releases, then run:

```sh
chmod +x build-llama-opencl.sh
./build-llama-opencl.sh
```

The script verifies Qualcomm OpenCL visibility, installs build packages, clones or fast-forwards upstream llama.cpp, and builds the CLI, server and benchmark with the Adreno-optimised OpenCL backend. It leaves Ollama untouched.

## 2. Install the wrappers

```sh
mkdir -p ~/.local/bin ~/.config/privatellmlens
cp llama-gpu privatellmlens ~/.local/bin/
chmod +x ~/.local/bin/llama-gpu ~/.local/bin/privatellmlens
cp profiles.example.conf ~/.config/privatellmlens/profiles.conf
```

Ensure `~/.local/bin` is on `PATH`, then verify:

```sh
llama-gpu devices
```

Expected output includes `GPUOpenCL: QUALCOMM Adreno(TM) ...`. Preserve the wrapper's Termux/system/vendor library ordering; placing `/vendor/lib64` first can load incompatible Android C++ libraries.

## 3. Configure profiles

Edit `~/.config/privatellmlens/profiles.conf`:

```text
profile-name|/absolute/model/path.gguf|server-alias|context-size|kv-cache-type
```

Ollama GGUF payloads normally live under `~/.ollama/models/blobs`. Its manifests identify the model layer digest. The example file contains no device-specific hashes or paths.

## 4. Configure the application location

The launcher defaults to:

```text
~/storage/shared/projects/privatellmlens/index.html
```

Override it when necessary:

```sh
export PRIVATE_LLM_LENS_APP_DIR="/absolute/path/to/privatellmlens"
```

## 5. Launch and switch backends

```sh
privatellmlens
privatellmlens --gpu qwen3-4b
privatellmlens --ollama
privatellmlens --gpu-list
privatellmlens --stop
```

The default backend is Ollama. `--gpu PROFILE` switches to llama.cpp and remembers the profile/backend; `--ollama` switches back. After either switch, plain `privatellmlens` uses the remembered choice.

Only one inference backend runs at a time. Starting GPU mode stops Ollama; starting Ollama mode stops llama.cpp. This prevents simultaneous multi-gigabyte model allocations from causing Android to kill the Termux process group. Ollama is constrained to one loaded model and one parallel request. llama.cpp uses one slot (`-np 1`).

The launcher also starts the loopback web server, prefers Microsoft Edge and then Chrome when opening the application, and holds a Termux wake lock. It falls back to Android's default browser only when neither preferred browser is installed. This ordering makes browser WebGPU available even when Firefox is the system default. `--stop` stops both possible backends and the web server, then releases the wake lock.

If a home-screen PWA was previously installed through Firefox, that shortcut remains tied to Firefox. Remove it and reinstall PrivateLLMLens from Edge or Chrome if WebGPU is required.

The PrivateLLMLens header probes both providers and reports **GPU connected** or **Ollama connected**.

## Mobile layout

The default **Automatic** layout uses the compact composer on narrow or coarse-pointer displays. On foldables or tablets, use the header layout button for an immediate Compact/Desktop switch, or choose **Automatic**, **Compact**, or **Desktop** under **Settings → Appearance → Layout**. The choice is stored on that browser. Compact mode uses stable Tools and Model bottom sheets and keeps the response-copy action visible.

## Security

Both servers bind only to loopback. CORS is limited to the local PrivateLLMLens origins. Do not bind to `0.0.0.0` or use wildcard CORS unless you understand that other network clients or websites may submit prompts to the local model.

## Troubleshooting

Logs are stored in `~/.local/state/privatellmlens/`.

- **Disconnected on first display:** allow model loading to finish; the status probe repeats automatically.
- **Server starts then disappears:** remove battery restrictions for Termux and confirm the wake-lock permission/integration works.
- **Android kills Termux:** confirm only one backend is active, use `-np 1`, lower context, or select a smaller model.
- **`cannot locate symbol ... liblog.so`:** preserve the `llama-gpu` library ordering.
- **No `GPUOpenCL` device:** confirm `/vendor/lib64/libOpenCL.so` is readable and the build reported the OpenCL backend.
- **First launch is slow:** model loading and OpenCL kernel compilation take time; kernels are cached afterward.
- **Page opens in Firefox:** launch with the `privatellmlens` command rather than an old Firefox-installed PWA shortcut; confirm Edge or Chrome is installed.
- **Thermal throttling:** avoid sustained inference while charging under an insulating cover.

## Updating and removal

Re-run `build-llama-opencl.sh` to fast-forward and rebuild upstream llama.cpp. Repeat a correctness/performance test after updates.

Stop services before removing files:

```sh
privatellmlens --stop
```

The wrappers, configuration, llama.cpp source/build, OpenCL cache and launcher state are independent of Ollama models and browser conversations.
