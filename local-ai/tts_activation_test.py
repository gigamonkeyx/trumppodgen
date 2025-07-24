#!/usr/bin/env python3
"""
TTS Parameter Evolution Activation Test - Phase 3
Activating deployed TTS optimization with parameter evolution
"""

import json
import time
from datetime import datetime
from tts_optimization import EnhancedTTSSystem

def run_tts_activation():
    """Activate TTS parameter evolution with fp16 Bark optimization"""
    
    print("="*60)
    print("TTS PARAMETER EVOLUTION ACTIVATION - PHASE 3")
    print("="*60)
    
    # Initialize enhanced TTS system with deployed optimization
    tts_system = EnhancedTTSSystem()
    
    print(f"Enhanced TTS System Status:")
    print(f"  fp16 Bark Enabled: {tts_system.fp16_enabled}")
    print(f"  Beam Width: {tts_system.beam_width}")
    print(f"  Advanced Parameter Evolution: {tts_system.advanced_parameter_evolution}")
    print(f"  MOS Target Preservation: {tts_system.mos_target_preservation}")
    print(f"  Parameter Mutation Rate: {tts_system.parameter_mutation_rate}")
    print(f"  GPU Available: {tts_system.gpu_available}")
    
    # Test parameter evolution activation
    print(f"\nActivating TTS parameter evolution...")
    start_time = time.time()
    
    try:
        # Test parameter evolution
        evolved_params = tts_system.evolve_tts_parameters()
        
        # Test enhanced TTS processing with Hitchens sample
        test_text = "On the contrary, I would suggest that the evidence points in quite the opposite direction, as any student of history knows."
        voice_config = {
            'accent': 'british_educated',
            'tone': 'intellectual_authoritative',
            'persona': 'hitchens_advanced'
        }
        
        # Process with evolved parameters
        tts_result = tts_system.process_hitchens_tts(test_text, voice_config)
        
        activation_time = time.time() - start_time
        
        # Analyze results
        quality_metrics = tts_result.get('quality_metrics', {})
        performance_metrics = tts_result.get('performance_metrics', {})
        
        activation_results = {
            'activation_timestamp': datetime.now().isoformat(),
            'activation_duration': activation_time,
            'parameter_evolution': {
                'evolved_params': evolved_params,
                'evolution_applied': evolved_params.get('evolution_applied', False),
                'beam_width_evolved': evolved_params.get('beam_width', tts_system.beam_width),
                'chunk_size_evolved': evolved_params.get('chunk_size', 256),
                'temperature_evolved': evolved_params.get('temperature', 0.8),
                'quality_boost': evolved_params.get('quality_boost', 1.0)
            },
            'tts_processing_results': tts_result,
            'quality_assessment': {
                'voice_authenticity': quality_metrics.get('voice_authenticity', 0.0),
                'british_accent_accuracy': quality_metrics.get('british_accent_accuracy', 0.0),
                'intellectual_tone_consistency': quality_metrics.get('intellectual_tone_consistency', 0.0),
                'hitchens_similarity': quality_metrics.get('hitchens_similarity', 0.0),
                'naturalness_mos': quality_metrics.get('naturalness_mos', 0.0),
                'mos_target_maintained': quality_metrics.get('naturalness_mos', 0.0) >= tts_system.mos_target_preservation
            },
            'performance_assessment': {
                'speed_improvement': performance_metrics.get('speed_improvement', 1.0),
                'memory_efficiency': performance_metrics.get('memory_efficiency', 1.0),
                'throughput_boost': performance_metrics.get('throughput_boost', 1.0),
                'latency_reduction': performance_metrics.get('latency_reduction', 1.0),
                'gpu_acceleration_active': tts_result.get('optimizations_applied', {}).get('gpu_acceleration', False)
            },
            'system_status': {
                'fp16_bark_active': tts_result.get('optimizations_applied', {}).get('fp16_bark', False),
                'beam_width_3_active': tts_result.get('optimizations_applied', {}).get('beam_width_3', False),
                'parameter_evolution_active': tts_result.get('technical_details', {}).get('parameter_evolution_applied', False),
                'gpu_utilized': tts_result.get('technical_details', {}).get('gpu_utilized', False)
            }
        }
        
        # Calculate overall success
        mos_maintained = activation_results['quality_assessment']['mos_target_maintained']
        evolution_active = activation_results['parameter_evolution']['evolution_applied']
        gpu_active = activation_results['performance_assessment']['gpu_acceleration_active']
        
        overall_success = mos_maintained and evolution_active
        
        print(f"\nTTS Parameter Evolution Results:")
        print(f"  Parameter Evolution Applied: {'✅' if evolution_active else '❌'}")
        print(f"  Beam Width: {evolved_params.get('beam_width', tts_system.beam_width)}")
        print(f"  Chunk Size: {evolved_params.get('chunk_size', 256)}")
        print(f"  Temperature: {evolved_params.get('temperature', 0.8)}")
        print(f"  Quality Boost: {evolved_params.get('quality_boost', 1.0):.3f}")
        print(f"  MOS Score: {quality_metrics.get('naturalness_mos', 0.0)}")
        print(f"  MOS Target Maintained: {'✅' if mos_maintained else '❌'}")
        print(f"  GPU Acceleration: {'✅' if gpu_active else '❌'}")
        print(f"  Voice Authenticity: {quality_metrics.get('voice_authenticity', 0.0):.3f}")
        print(f"  Activation Time: {activation_time:.3f}s")
        
        # Save activation results
        with open('local-ai/tts_activation_results.json', 'w') as f:
            json.dump(activation_results, f, indent=2)
        
        print(f"\nPhase 3.1 Complete: TTS activation {'SUCCESS' if overall_success else 'PARTIAL'}")
        return activation_results
        
    except Exception as e:
        print(f"TTS activation error: {e}")
        return {
            'activation_timestamp': datetime.now().isoformat(),
            'activation_duration': time.time() - start_time,
            'error': str(e),
            'status': 'failed'
        }

if __name__ == "__main__":
    run_tts_activation()
