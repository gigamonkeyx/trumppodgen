@echo off
echo ============================================================
echo PYTORCH D: DRIVE INSTALLATION - PHASE 2
echo ============================================================

echo Step 1: Creating PyTorch environment on D: drive...
if not exist "D:\pytorch_env" mkdir "D:\pytorch_env"
if not exist "D:\pytorch_env\pip_cache" mkdir "D:\pytorch_env\pip_cache"
if not exist "D:\pytorch_env\site-packages" mkdir "D:\pytorch_env\site-packages"

echo Step 2: Setting environment variables for D: drive installation...
set PIP_CACHE_DIR=D:\pytorch_env\pip_cache
set PYTHONUSERBASE=D:\pytorch_env
set PYTHONPATH=D:\pytorch_env\site-packages;%PYTHONPATH%

echo Step 3: Cleaning up any existing PyTorch installations on C: drive...
pip uninstall torch torchvision torchaudio -y

echo Step 4: Installing PyTorch to D: drive with CUDA 11.8 support...
pip install --user --target "D:\pytorch_env\site-packages" torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

echo Step 5: Verifying installation...
python -c "import sys; sys.path.insert(0, 'D:/pytorch_env/site-packages'); import torch; print(f'PyTorch {torch.__version__} installed on D: drive'); print(f'CUDA Available: {torch.cuda.is_available()}')"

echo Step 6: Creating environment activation script...
echo @echo off > activate_pytorch_d.bat
echo set PYTHONPATH=D:\pytorch_env\site-packages;%%PYTHONPATH%% >> activate_pytorch_d.bat
echo echo PyTorch D: drive environment activated >> activate_pytorch_d.bat

echo ============================================================
echo PyTorch D: drive installation complete!
echo Run 'activate_pytorch_d.bat' before using Bark TTS
echo ============================================================
pause
