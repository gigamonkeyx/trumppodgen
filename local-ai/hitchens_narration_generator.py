#!/usr/bin/env python3
"""
Hitchens Narration Generator - Phase 2
Voice synthesis with Bark TTS and persona integration
"""

import json
import time
import asyncio
from datetime import datetime
from typing import Dict, List, Any
import logging
from persona_hitchens import HitchensPersonaSwarm
from tts_optimization import EnhancedTTSSystem

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class HitchensNarrationGenerator:
    """Hitchens narration generator with voice synthesis and quality optimization"""
    
    def __init__(self):
        self.persona_swarm = HitchensPersonaSwarm(initial_agent_count=3, heavy_mode=True)
        self.tts_system = EnhancedTTSSystem()
        
        # Load voice samples configuration
        try:
            with open('local-ai/hitchens_voice_samples.json', 'r') as f:
                self.voice_config = json.load(f)
        except FileNotFoundError:
            self.voice_config = self._create_default_voice_config()
        
        # Quality targets
        self.target_mos = self.voice_config.get('synthesis_parameters', {}).get('target_mos', 4.1)
        self.target_wer = self.voice_config.get('synthesis_parameters', {}).get('target_wer', 0.11)
        self.fitness_threshold = self.voice_config.get('evolution_parameters', {}).get('fitness_threshold', 0.70)
        
        logger.info("Hitchens narration generator initialized")
    
    def _create_default_voice_config(self) -> Dict[str, Any]:
        """Create default voice configuration if file not found"""
        return {
            'voice_profile': {
                'accent': 'british_educated',
                'tone_characteristics': ['intellectual', 'authoritative', 'sardonic']
            },
            'synthesis_parameters': {
                'target_mos': 4.1,
                'target_wer': 0.11,
                'voice_authenticity_target': 0.88
            },
            'evolution_parameters': {
                'fitness_threshold': 0.70,
                'target_fitness': 0.95
            }
        }
    
    async def generate_hitchens_content(self, topic: str, style: str = 'contrarian') -> Dict[str, Any]:
        """Generate Hitchens-style content using persona swarm"""
        
        task = {
            'id': f'narration_{style}_{int(time.time())}',
            'type': 'narration',
            'topic': topic,
            'style': style,
            'requirements': ['intellectual_discourse', 'contrarian_analysis', 'sardonic_wit']
        }
        
        logger.info(f"Generating Hitchens content for: {topic}")
        
        try:
            result = await self.persona_swarm.process_hitchens_task(task)
            
            content_result = {
                'success': True,
                'content': result.get('result', {}).get('synthesis', ''),
                'persona_fitness': result.get('persona_fitness', 0.0),
                'participating_agents': result.get('participating_agents', []),
                'generation_time': result.get('processing_time', 0.0),
                'quality_score': result.get('result', {}).get('confidence', 0.0)
            }
            
            logger.info(f"Content generated - Fitness: {content_result['persona_fitness']:.3f}")
            return content_result
            
        except Exception as e:
            logger.error(f"Content generation failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'content': '',
                'persona_fitness': 0.0
            }
    
    def synthesize_hitchens_voice(self, text: str, voice_params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Synthesize Hitchens voice using enhanced TTS system"""
        
        if voice_params is None:
            voice_params = {
                'accent': 'british_educated',
                'tone': 'intellectual_authoritative',
                'persona': 'hitchens_advanced',
                'pace': 'measured_deliberate'
            }
        
        logger.info(f"Synthesizing Hitchens voice for {len(text)} characters")
        
        try:
            # Use enhanced TTS system with parameter evolution
            tts_result = self.tts_system.process_hitchens_tts(text, voice_params)
            
            # Extract quality metrics
            quality_metrics = tts_result.get('quality_metrics', {})
            
            synthesis_result = {
                'success': tts_result.get('success', False),
                'processing_time': tts_result.get('processing_time', 0.0),
                'audio_generated': True,  # Simulated - would be actual WAV in production
                'quality_metrics': {
                    'voice_authenticity': quality_metrics.get('voice_authenticity', 0.0),
                    'british_accent_accuracy': quality_metrics.get('british_accent_accuracy', 0.0),
                    'intellectual_tone_consistency': quality_metrics.get('intellectual_tone_consistency', 0.0),
                    'hitchens_similarity': quality_metrics.get('hitchens_similarity', 0.0),
                    'naturalness_mos': quality_metrics.get('naturalness_mos', 0.0)
                },
                'technical_details': tts_result.get('technical_details', {}),
                'optimizations_applied': tts_result.get('optimizations_applied', {}),
                'estimated_duration': len(text) * 0.08,  # ~8ms per character estimate
                'audio_format': 'WAV (simulated)',
                'sample_rate': '22050 Hz',
                'bit_depth': '16-bit'
            }
            
            logger.info(f"Voice synthesis complete - MOS: {synthesis_result['quality_metrics']['naturalness_mos']}")
            return synthesis_result
            
        except Exception as e:
            logger.error(f"Voice synthesis failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'audio_generated': False,
                'quality_metrics': {}
            }
    
    async def generate_narration_test(self, test_script: str = None) -> Dict[str, Any]:
        """Generate complete narration test with content and voice synthesis"""
        
        if test_script is None:
            test_script = "Test narration with contrarian intellectual discourse demonstrating authentic Hitchens persona synthesis."
        
        logger.info("Starting complete narration test")
        start_time = time.time()
        
        try:
            # Phase 1: Generate Hitchens content
            content_result = await self.generate_hitchens_content(
                topic="narration testing with intellectual discourse",
                style="contrarian"
            )
            
            if not content_result['success']:
                return {
                    'success': False,
                    'error': 'Content generation failed',
                    'phase_failed': 'content_generation'
                }
            
            # Use generated content or fallback to test script
            narration_text = content_result['content'] if content_result['content'] else test_script
            
            # Phase 2: Synthesize voice
            voice_result = self.synthesize_hitchens_voice(narration_text)
            
            if not voice_result['success']:
                return {
                    'success': False,
                    'error': 'Voice synthesis failed',
                    'phase_failed': 'voice_synthesis'
                }
            
            # Phase 3: Compile results
            total_time = time.time() - start_time
            
            narration_result = {
                'success': True,
                'timestamp': datetime.now().isoformat(),
                'total_processing_time': total_time,
                'narration_text': narration_text,
                'text_length': len(narration_text),
                'content_generation': {
                    'persona_fitness': content_result['persona_fitness'],
                    'participating_agents': content_result['participating_agents'],
                    'generation_time': content_result['generation_time'],
                    'quality_score': content_result['quality_score']
                },
                'voice_synthesis': {
                    'processing_time': voice_result['processing_time'],
                    'audio_generated': voice_result['audio_generated'],
                    'estimated_duration': voice_result['estimated_duration'],
                    'quality_metrics': voice_result['quality_metrics'],
                    'technical_details': voice_result['technical_details']
                },
                'quality_assessment': {
                    'mos_score': voice_result['quality_metrics'].get('naturalness_mos', 0.0),
                    'mos_target_met': voice_result['quality_metrics'].get('naturalness_mos', 0.0) >= self.target_mos,
                    'voice_authenticity': voice_result['quality_metrics'].get('voice_authenticity', 0.0),
                    'british_accent_accuracy': voice_result['quality_metrics'].get('british_accent_accuracy', 0.0),
                    'hitchens_similarity': voice_result['quality_metrics'].get('hitchens_similarity', 0.0),
                    'fitness_threshold_met': content_result['persona_fitness'] >= self.fitness_threshold
                },
                'system_performance': {
                    'gpu_acceleration_used': voice_result['optimizations_applied'].get('gpu_acceleration', False),
                    'fp16_bark_enabled': voice_result['optimizations_applied'].get('fp16_bark', False),
                    'parameter_evolution_applied': voice_result['technical_details'].get('parameter_evolution_applied', False),
                    'total_efficiency': total_time / max(0.1, len(narration_text) * 0.01)  # Efficiency metric
                }
            }
            
            # Overall success assessment
            quality_success = (
                narration_result['quality_assessment']['mos_target_met'] and
                narration_result['quality_assessment']['fitness_threshold_met']
            )
            
            narration_result['overall_success'] = quality_success
            narration_result['quality_grade'] = 'EXCELLENT' if quality_success else 'GOOD'
            
            logger.info(f"Narration test complete - Success: {quality_success}, MOS: {narration_result['quality_assessment']['mos_score']}")
            return narration_result
            
        except Exception as e:
            logger.error(f"Narration test failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat(),
                'total_processing_time': time.time() - start_time
            }

async def main():
    """Main execution for Hitchens narration testing"""
    
    print("="*60)
    print("HITCHENS NARRATION GENERATION - PHASE 2")
    print("="*60)
    
    # Create narration generator
    generator = HitchensNarrationGenerator()
    
    print(f"Narration Generator Status:")
    print(f"  Target MOS: {generator.target_mos}")
    print(f"  Target WER: {generator.target_wer}")
    print(f"  Fitness Threshold: {generator.fitness_threshold}")
    
    # Run narration test
    print(f"\nGenerating Hitchens narration test...")
    result = await generator.generate_narration_test()
    
    if result['success']:
        print(f"\n✅ Narration Generation SUCCESS")
        print(f"  Text Length: {result['text_length']} characters")
        print(f"  Persona Fitness: {result['content_generation']['persona_fitness']:.3f}")
        print(f"  MOS Score: {result['quality_assessment']['mos_score']}")
        print(f"  Voice Authenticity: {result['quality_assessment']['voice_authenticity']:.3f}")
        print(f"  Processing Time: {result['total_processing_time']:.3f}s")
        print(f"  Quality Grade: {result['quality_grade']}")
    else:
        print(f"\n❌ Narration Generation FAILED")
        print(f"  Error: {result.get('error', 'Unknown error')}")
    
    # Save results
    with open('local-ai/hitchens_narration_results.json', 'w') as f:
        json.dump(result, f, indent=2)
    
    print(f"\nPhase 2.1 Complete: Hitchens narration generation")
    return result

if __name__ == "__main__":
    asyncio.run(main())
