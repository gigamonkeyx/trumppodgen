#!/usr/bin/env python3
"""
Tortoise-TTS Integration for Trump Podcast Generator
GPU-accelerated local voice synthesis
"""

import sys
import json
import os
import argparse
from pathlib import Path
import torch
import torchaudio
import time

try:
    from tortoise.api import TextToSpeech
    from tortoise.utils.audio import load_audio, load_voice, load_voices
except ImportError:
    print(json.dumps({
        "error": "Tortoise-TTS not installed. Run: pip install tortoise-tts",
        "success": False
    }))
    sys.exit(1)

class TrumpTTS:
    def __init__(self, models_dir="./models", output_dir="./audio"):
        self.models_dir = Path(models_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Initialize Tortoise-TTS
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Using device: {self.device}", file=sys.stderr)
        
        try:
            self.tts = TextToSpeech(models_dir=str(self.models_dir))
        except Exception as e:
            print(json.dumps({
                "error": f"Failed to initialize Tortoise-TTS: {str(e)}",
                "success": False
            }))
            sys.exit(1)
    
    def generate_audio(self, text, voice="trump", preset="fast", output_file=None):
        """
        Generate audio from text using specified voice
        
        Args:
            text (str): Text to synthesize
            voice (str): Voice name (default: trump)
            preset (str): Quality preset (ultra_fast, fast, standard, high_quality)
            output_file (str): Output filename
        
        Returns:
            dict: Result with success status and file path
        """
        try:
            if not output_file:
                timestamp = int(time.time())
                output_file = f"speech_{timestamp}.wav"
            
            output_path = self.output_dir / output_file
            
            # Load voice samples (if available)
            voice_samples = None
            voice_dir = self.models_dir / "voices" / voice
            if voice_dir.exists():
                voice_samples, conditioning_latents = load_voice(voice, str(voice_dir))
            
            # Generate audio
            print(f"Generating audio for {len(text)} characters...", file=sys.stderr)
            start_time = time.time()
            
            gen = self.tts.tts_with_preset(
                text, 
                voice_samples=voice_samples, 
                conditioning_latents=conditioning_latents if voice_samples else None,
                preset=preset
            )
            
            # Save audio
            torchaudio.save(str(output_path), gen.squeeze(0).cpu(), 24000)
            
            generation_time = time.time() - start_time
            
            return {
                "success": True,
                "output_file": str(output_path),
                "duration": generation_time,
                "text_length": len(text),
                "voice": voice,
                "preset": preset,
                "device": self.device
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "text_length": len(text) if text else 0
            }
    
    def list_voices(self):
        """List available voices"""
        voices_dir = self.models_dir / "voices"
        if not voices_dir.exists():
            return []
        
        voices = []
        for voice_dir in voices_dir.iterdir():
            if voice_dir.is_dir():
                voices.append(voice_dir.name)
        
        return voices
    
    def get_system_info(self):
        """Get system information for diagnostics"""
        return {
            "device": self.device,
            "cuda_available": torch.cuda.is_available(),
            "gpu_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
            "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "models_dir": str(self.models_dir),
            "output_dir": str(self.output_dir),
            "available_voices": self.list_voices()
        }

def main():
    parser = argparse.ArgumentParser(description="Trump Podcast TTS Generator")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--voice", default="trump", help="Voice to use")
    parser.add_argument("--preset", default="fast", choices=["ultra_fast", "fast", "standard", "high_quality"])
    parser.add_argument("--output", help="Output filename")
    parser.add_argument("--models-dir", default="./models", help="Models directory")
    parser.add_argument("--output-dir", default="./audio", help="Output directory")
    parser.add_argument("--info", action="store_true", help="Show system info")
    
    args = parser.parse_args()
    
    try:
        tts = TrumpTTS(models_dir=args.models_dir, output_dir=args.output_dir)
        
        if args.info:
            result = tts.get_system_info()
        else:
            result = tts.generate_audio(
                text=args.text,
                voice=args.voice,
                preset=args.preset,
                output_file=args.output
            )
        
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
