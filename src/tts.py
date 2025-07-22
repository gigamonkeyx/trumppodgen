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
    
    def generate_audio(self, text, voice="trump", preset="fast", output_file=None, custom_voice_path=None):
        """
        Generate audio from text using specified voice with optional custom voice cloning

        Args:
            text (str): Text to synthesize
            voice (str): Voice name (default: trump)
            preset (str): Quality preset (ultra_fast, fast, standard, high_quality)
            output_file (str): Output filename
            custom_voice_path (str): Path to custom voice samples for cloning

        Returns:
            dict: Result with success status and file path
        """
        try:
            if not output_file:
                timestamp = int(time.time())
                output_file = f"speech_{timestamp}.wav"

            output_path = self.output_dir / output_file

            # Load voice samples (custom or preset)
            voice_samples = None
            conditioning_latents = None

            if custom_voice_path and Path(custom_voice_path).exists():
                # Use custom voice samples for cloning
                print(f"Loading custom voice from {custom_voice_path}...", file=sys.stderr)
                voice_samples, conditioning_latents = self.load_custom_voice(custom_voice_path)
                voice_used = f"custom_{Path(custom_voice_path).stem}"
            else:
                # Use preset voice
                voice_dir = self.models_dir / "voices" / voice
                if voice_dir.exists():
                    voice_samples, conditioning_latents = load_voice(voice, str(voice_dir))
                voice_used = voice

            # Generate audio
            print(f"Generating audio for {len(text)} characters with voice '{voice_used}'...", file=sys.stderr)
            start_time = time.time()

            gen = self.tts.tts_with_preset(
                text,
                voice_samples=voice_samples,
                conditioning_latents=conditioning_latents,
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
                "voice": voice_used,
                "preset": preset,
                "device": self.device,
                "custom_voice": custom_voice_path is not None
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "text_length": len(text) if text else 0
            }

    def load_custom_voice(self, voice_path):
        """
        Load custom voice samples and generate conditioning latents

        Args:
            voice_path (str): Path to audio file or directory with samples

        Returns:
            tuple: (voice_samples, conditioning_latents)
        """
        try:
            voice_path = Path(voice_path)

            if voice_path.is_file():
                # Single audio file
                audio_files = [voice_path]
            elif voice_path.is_dir():
                # Directory with multiple samples
                audio_files = list(voice_path.glob("*.wav")) + list(voice_path.glob("*.mp3"))
                if not audio_files:
                    raise ValueError(f"No audio files found in {voice_path}")
            else:
                raise ValueError(f"Voice path does not exist: {voice_path}")

            # Load and process audio samples
            voice_samples = []
            for audio_file in audio_files[:10]:  # Limit to 10 samples for performance
                try:
                    audio = load_audio(str(audio_file), 22050)
                    voice_samples.append(audio)
                    print(f"Loaded voice sample: {audio_file.name}", file=sys.stderr)
                except Exception as e:
                    print(f"Failed to load {audio_file}: {e}", file=sys.stderr)
                    continue

            if not voice_samples:
                raise ValueError("No valid voice samples could be loaded")

            # Generate conditioning latents
            conditioning_latents = self.tts.get_conditioning_latents(voice_samples)

            return voice_samples, conditioning_latents

        except Exception as e:
            print(f"Custom voice loading failed: {e}", file=sys.stderr)
            raise

    def create_voice_clone(self, voice_name, audio_files, description="Custom cloned voice"):
        """
        Create a new voice clone from uploaded audio files

        Args:
            voice_name (str): Name for the new voice
            audio_files (list): List of audio file paths
            description (str): Description of the voice

        Returns:
            dict: Result with success status and voice info
        """
        try:
            voice_dir = self.models_dir / "voices" / voice_name
            voice_dir.mkdir(parents=True, exist_ok=True)

            # Process and save voice samples
            processed_samples = []
            for i, audio_file in enumerate(audio_files[:10]):  # Limit to 10 samples
                try:
                    # Load and normalize audio
                    audio = load_audio(audio_file, 22050)

                    # Save processed sample
                    sample_path = voice_dir / f"sample_{i:02d}.wav"
                    torchaudio.save(str(sample_path), audio.unsqueeze(0), 22050)
                    processed_samples.append(str(sample_path))

                except Exception as e:
                    print(f"Failed to process {audio_file}: {e}", file=sys.stderr)
                    continue

            if not processed_samples:
                raise ValueError("No audio samples could be processed")

            # Create voice info file
            voice_info = {
                "name": voice_name,
                "description": description,
                "samples": processed_samples,
                "created_at": time.time(),
                "sample_count": len(processed_samples)
            }

            info_path = voice_dir / "voice_info.json"
            with open(info_path, 'w') as f:
                json.dump(voice_info, f, indent=2)

            return {
                "success": True,
                "voice_name": voice_name,
                "voice_dir": str(voice_dir),
                "sample_count": len(processed_samples),
                "message": f"Voice clone '{voice_name}' created successfully"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
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
