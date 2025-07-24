#!/usr/bin/env python3
"""
Find existing PyTorch installations and set up D: drive path
"""

import os
import sys
import glob
from pathlib import Path

def find_pytorch_installations():
    """Find existing PyTorch installations on the system"""
    
    print("="*60)
    print("PYTORCH INSTALLATION FINDER")
    print("="*60)
    
    # Common PyTorch installation locations
    search_paths = [
        "C:/Python*/Lib/site-packages/torch*",
        "C:/Users/*/AppData/Local/Programs/Python/*/Lib/site-packages/torch*",
        "C:/Users/*/AppData/Roaming/Python/*/site-packages/torch*",
        "D:/*/torch*",
        "D:/Python*/Lib/site-packages/torch*",
        "D:/pytorch_env/site-packages/torch*"
    ]
    
    found_installations = []
    
    for pattern in search_paths:
        try:
            matches = glob.glob(pattern, recursive=True)
            for match in matches:
                if os.path.isdir(match) and 'torch' in os.path.basename(match).lower():
                    found_installations.append(match)
        except Exception as e:
            continue
    
    print(f"Found {len(found_installations)} PyTorch-related directories:")
    for install in found_installations:
        size = get_dir_size(install)
        print(f"  {install} ({size:.1f} MB)")
    
    return found_installations

def get_dir_size(path):
    """Get directory size in MB"""
    try:
        total_size = 0
        for dirpath, dirnames, filenames in os.walk(path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                if os.path.exists(filepath):
                    total_size += os.path.getsize(filepath)
        return total_size / (1024 * 1024)  # Convert to MB
    except:
        return 0

def test_pytorch_import():
    """Test PyTorch import with different path configurations"""
    
    print("\n" + "="*60)
    print("PYTORCH IMPORT TESTING")
    print("="*60)
    
    # Test 1: Default import
    print("Test 1: Default PyTorch import...")
    try:
        import torch
        print(f"  ✅ SUCCESS: PyTorch {torch.__version__}")
        print(f"  CUDA Available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"  GPU: {torch.cuda.get_device_name(0)}")
        return True
    except Exception as e:
        print(f"  ❌ FAILED: {e}")
    
    # Test 2: Try with D: drive path
    print("\nTest 2: D: drive PyTorch import...")
    d_drive_paths = [
        "D:/pytorch_env/site-packages",
        "D:/Python311/Lib/site-packages"
    ]
    
    for path in d_drive_paths:
        if os.path.exists(path):
            print(f"  Trying path: {path}")
            sys.path.insert(0, path)
            try:
                import torch
                print(f"  ✅ SUCCESS: PyTorch {torch.__version__} from {path}")
                return True
            except Exception as e:
                print(f"  ❌ FAILED: {e}")
                sys.path.remove(path)
    
    return False

def setup_bark_environment():
    """Set up environment for Bark TTS"""
    
    print("\n" + "="*60)
    print("BARK ENVIRONMENT SETUP")
    print("="*60)
    
    # Check if we can import Bark
    try:
        from bark import generate_audio
        print("✅ Bark TTS is ready to use!")
        return True
    except Exception as e:
        print(f"❌ Bark TTS not available: {e}")
        print("\nTo fix this:")
        print("1. Run install_pytorch_d_drive.bat")
        print("2. Or manually install: pip install --target D:/pytorch_env/site-packages torch torchvision torchaudio")
        print("3. Set PYTHONPATH=D:/pytorch_env/site-packages")
        return False

def clean_c_drive():
    """Suggest C: drive cleanup"""
    
    print("\n" + "="*60)
    print("C: DRIVE CLEANUP SUGGESTIONS")
    print("="*60)
    
    # Check C: drive space
    try:
        import shutil
        total, used, free = shutil.disk_usage("C:/")
        free_gb = free / (1024**3)
        print(f"C: drive free space: {free_gb:.1f} GB")
        
        if free_gb < 5:
            print("⚠️  WARNING: Low disk space on C: drive!")
            print("\nCleanup suggestions:")
            print("1. Run: pip cache purge")
            print("2. Delete temp files: del /q /s C:\\Users\\%USERNAME%\\AppData\\Local\\Temp\\*")
            print("3. Move PyTorch to D: drive using install_pytorch_d_drive.bat")
        else:
            print("✅ C: drive has sufficient space")
            
    except Exception as e:
        print(f"Could not check C: drive space: {e}")

def main():
    """Main execution"""
    
    # Find existing installations
    installations = find_pytorch_installations()
    
    # Test PyTorch import
    pytorch_working = test_pytorch_import()
    
    # Setup Bark environment
    bark_ready = setup_bark_environment()
    
    # Cleanup suggestions
    clean_c_drive()
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"PyTorch installations found: {len(installations)}")
    print(f"PyTorch import working: {'✅' if pytorch_working else '❌'}")
    print(f"Bark TTS ready: {'✅' if bark_ready else '❌'}")
    
    if not pytorch_working:
        print("\nNext steps:")
        print("1. Run install_pytorch_d_drive.bat to install PyTorch on D: drive")
        print("2. Use activate_pytorch_d.bat before running Bark TTS")
    
    return pytorch_working and bark_ready

if __name__ == "__main__":
    main()
