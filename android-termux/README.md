# Android/Termux Adreno acceleration

This optional setup runs PrivateLLMLens against a native `llama.cpp` server accelerated by Qualcomm OpenCL. It does not replace Ollama and is not needed by desktop, GitHub Pages, or browser-WebGPU users.

The setup was developed and tested on a Samsung Galaxy Z Fold 8 (`SM-F971B`, Snapdragon SM8850, Adreno 840, Android 17). Other recent Adreno devices may work, but mobile OpenCL drivers, accessible memory, thermals, and performance vary. Do not assume these context sizes are safe on another phone.

## Tested Fold 8 results

All measurements used full GPU offload and existing Ollama GGUF blobs.

| Profile | Quantisation | Context | Prompt | Generation |
| --- | --- | ---: | ---: | ---: |
| Qwen3 4B | Q4_K_M | 32K | 287 tok/s | 19.8 tok/s |
| Mistral 7B | Q4_K_M | 16K | 147 tok/s | 13.2 tok/s |
| DeepSeek-R1/Qwen3 8B | Q4_K_M | 8K | 141 tok/s | 11.5 tok/s |
| Gemma 4 E4B | Q4_0 | 8K | 203 tok/s | 17.7 tok/s |

The larger models use smaller contexts to leave GPU headroom for compute buffers. Gemma is configured for text only; its vision projector requires additional memory and server configuration.

## 1. Build llama.cpp

Install Termux from F-Droid or its official GitHub releases, then run:

```sh
chmod +x build-llama-opencl.sh
./build-llama-opencl.sh
```

The script:

- verifies `/vendor/lib64/libOpenCL.so` is visible;
- installs the required Termux build packages;
- clones or fast-forwards upstream llama.cpp in `~/src/llama.cpp`;
- builds `llama-cli`, `llama-server`, and `llama-bench` with the Adreno-optimised OpenCL backend;
- leaves an existing Ollama installation untouched.

It refuses to overwrite a non-Git directory at the chosen source location. Override the source directory with `LLAMA_CPP_SOURCE_DIR` if required.

## 2. Install the wrappers

```sh
mkdir -p ~/.local/bin ~/.config/privatellmlens
cp llama-gpu privatellmlens ~/.local/bin/
chmod +x ~/.local/bin/llama-gpu ~/.local/bin/privatellmlens
cp profiles.example.conf ~/.config/privatellmlens/profiles.conf
```

Ensure `~/.local/bin` is on `PATH`. Verify GPU discovery:

```sh
llama-gpu devices
```

Expected output contains an entry similar to:

```text
GPUOpenCL: QUALCOMM Adreno(TM) 840
```

The wrapper deliberately orders the Termux, Android system, and vendor library directories. Using `/vendor/lib64` alone first in `LD_LIBRARY_PATH` can load incompatible Android C++ libraries and prevent Termux executables from starting.

## 3. Configure model profiles

Edit `~/.config/privatellmlens/profiles.conf` and replace every example path you intend to use with the absolute path of a readable GGUF file. Remove unused example profiles.

Ollama stores model manifests beneath `~/.ollama/models/manifests` and GGUF payloads beneath `~/.ollama/models/blobs`. In each manifest, the layer with media type `application/vnd.ollama.image.model` identifies the relevant blob digest. Do not copy a multi-gigabyte blob unnecessarily; the server can read it in place.

Configuration format:

```text
profile-name|/absolute/model/path.gguf|server-alias|context-size|kv-cache-type
```

Treat the configuration file as local device state. The example in Git contains no user-specific model hashes or paths.

## 4. Configure the application location

The launcher defaults to:

```text
~/storage/shared/projects/privatellmlens/index.html
```

If your copy is elsewhere, export its directory before launching:

```sh
export PRIVATE_LLM_LENS_APP_DIR="/absolute/path/to/privatellmlens"
```

## 5. Launch and switch profiles

```sh
privatellmlens
privatellmlens --gpu-list
privatellmlens --gpu qwen3-4b
privatellmlens --stop
```

The launcher starts, when needed:

- Ollama on `127.0.0.1:11434`;
- the selected llama.cpp/OpenCL model on `127.0.0.1:8080`;
- a static PrivateLLMLens web server on `127.0.0.1:8765`;
- the Android browser at the local application URL.

The selected profile is remembered. Changing it restarts only llama.cpp. PrivateLLMLens discovers the active server through `/v1/models`; if no server is present, the Adreno option simply does not appear.

## Security

The GPU server binds only to loopback and uses `--cors-origins localhost`. Do not change it to `0.0.0.0` or wildcard CORS unless you understand that other network clients or websites may then be able to submit prompts to your local model.

PrivateLLMLens sanitises rendered model Markdown, but model output and imported conversation backups should still be treated as untrusted data.

## Troubleshooting

Inspect logs in `~/.local/state/privatellmlens/`.

- `cannot locate symbol ... liblog.so`: preserve the library ordering used by `llama-gpu`.
- No `GPUOpenCL` device: confirm the vendor OpenCL library is readable and check the build reported `Including OpenCL backend`.
- Device loss, crashes, or allocation failure: reduce context, use Q8 KV cache, select a smaller model, or reduce GPU layers.
- First launch is slow: OpenCL kernels and the model must be loaded; compiled kernels are cached afterward.
- Thermal throttling: sustained phone inference is power intensive. Avoid charging under insulating covers and stop if the device becomes excessively hot.

## Updating

Re-run `build-llama-opencl.sh`. It performs a fast-forward source update and rebuilds the selected tools. Upstream changes can affect model compatibility and performance, so repeat a short correctness test after updating.

## Uninstalling these additions

Stop the services first:

```sh
privatellmlens --stop
```

Then remove the copied wrappers, configuration, llama.cpp source/build, OpenCL kernel cache, and PrivateLLMLens state if you no longer need them. These paths are independent of `~/.ollama`; deleting the Android integration does not require deleting Ollama models or conversations stored by the browser.
