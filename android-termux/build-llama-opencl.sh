#!/data/data/com.termux/files/usr/bin/sh
set -eu

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SOURCE_DIR="${LLAMA_CPP_SOURCE_DIR:-${HOME}/src/llama.cpp}"
BUILD_DIR="$SOURCE_DIR/build-opencl"
OPENCL_LIBRARY="/vendor/lib64/libOpenCL.so"

if [ ! -r "$OPENCL_LIBRARY" ]; then
  echo "Qualcomm's OpenCL library was not found at $OPENCL_LIBRARY." >&2
  echo "This setup is intended for compatible Snapdragon/Adreno Android devices." >&2
  exit 1
fi

pkg install -y git cmake ninja clang opencl-headers python
mkdir -p "$(dirname "$SOURCE_DIR")"

if [ -d "$SOURCE_DIR/.git" ]; then
  git -C "$SOURCE_DIR" pull --ff-only
elif [ -e "$SOURCE_DIR" ]; then
  echo "$SOURCE_DIR exists but is not a llama.cpp Git checkout; refusing to overwrite it." >&2
  exit 1
else
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$SOURCE_DIR"
fi

cmake -S "$SOURCE_DIR" -B "$BUILD_DIR" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_OPENCL=ON \
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON \
  -DOpenCL_INCLUDE_DIR="$TERMUX_PREFIX/include" \
  -DOpenCL_LIBRARY="$OPENCL_LIBRARY" \
  -DLLAMA_CURL=OFF

cmake --build "$BUILD_DIR" --target llama-cli llama-server llama-bench -j 4

echo
echo "Build complete: $BUILD_DIR/bin"
echo "Install or copy the llama-gpu wrapper, then run: llama-gpu devices"
