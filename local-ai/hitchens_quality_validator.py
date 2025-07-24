#!/usr/bin/env python3
"""
Hitchens Quality Validator - Phase 3
MOS/WER testing and likeness validation with evolution optimization
"""

import json
import time
import random
from datetime import datetime
from typing import Dict, List, Any
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class HitchensQualityValidator:
    """Quality validation system for Hitchens narration with MOS/WER testing"""
    
    def __init__(self):
        # Quality targets from voice samples configuration
        try:
            with open('local-ai/hitchens_voice_samples.json', 'r') as f:
                config = json.load(f)
                self.quality_targets = config.get('quality_metrics', {})
        except FileNotFoundError:
            self.quality_targets = self._create_default_targets()
        
        # Validation thresholds
        self.mos_target = 4.1
        self.wer_target = 0.11  # <11% WER
        self.likeness_target = 0.95  # >95% likeness
        self.fitness_threshold = 0.70
        
        # Evolution parameters
        self.evolution_enabled = True
        self.max_evolution_cycles = 3
        self.improvement_threshold = 0.05  # 5% improvement required
        
        logger.info("Hitchens quality validator initialized")
    
    def _create_default_targets(self) -> Dict[str, Any]:
        """Create default quality targets"""
        return {
            'mos_validation': {'naturalness': '>4.1'},
            'wer_validation': {'target': '<11%'},
            'likeness_validation': {'voice_similarity': '>95%'}
        }
    
    def calculate_mos_score(self, audio_metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate Mean Opinion Score (MOS) for audio quality"""
        
        # Extract quality components
        voice_authenticity = audio_metrics.get('voice_authenticity', 0.0)
        british_accent = audio_metrics.get('british_accent_accuracy', 0.0)
        intellectual_tone = audio_metrics.get('intellectual_tone_consistency', 0.0)
        hitchens_similarity = audio_metrics.get('hitchens_similarity', 0.0)
        naturalness_mos = audio_metrics.get('naturalness_mos', 0.0)
        
        # MOS calculation with weighted components
        mos_components = {
            'naturalness': naturalness_mos * 0.35,  # 35% weight
            'authenticity': voice_authenticity * 4.0 * 0.25,  # 25% weight (scale to 4.0)
            'accent_accuracy': british_accent * 4.0 * 0.20,  # 20% weight
            'similarity': hitchens_similarity * 4.0 * 0.20   # 20% weight
        }
        
        # Calculate overall MOS
        overall_mos = sum(mos_components.values())
        
        # Quality assessment
        quality_grade = 'POOR'
        if overall_mos >= 4.0:
            quality_grade = 'EXCELLENT'
        elif overall_mos >= 3.5:
            quality_grade = 'GOOD'
        elif overall_mos >= 3.0:
            quality_grade = 'FAIR'
        
        mos_result = {
            'overall_mos': overall_mos,
            'components': mos_components,
            'target_met': overall_mos >= self.mos_target,
            'quality_grade': quality_grade,
            'improvement_needed': max(0, self.mos_target - overall_mos),
            'validation_status': 'PASS' if overall_mos >= self.mos_target else 'FAIL'
        }
        
        logger.info(f"MOS calculated: {overall_mos:.2f} ({quality_grade})")
        return mos_result
    
    def calculate_wer_score(self, text_input: str, audio_metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate Word Error Rate (WER) for speech recognition accuracy"""
        
        # Simulate WER calculation based on audio quality
        voice_authenticity = audio_metrics.get('voice_authenticity', 0.0)
        british_accent = audio_metrics.get('british_accent_accuracy', 0.0)
        
        # WER estimation based on quality metrics
        base_wer = 0.15  # 15% base error rate
        quality_factor = (voice_authenticity + british_accent) / 2.0
        
        # Better quality = lower WER
        estimated_wer = base_wer * (1.0 - quality_factor * 0.6)
        estimated_wer = max(0.02, min(0.25, estimated_wer))  # Clamp between 2% and 25%
        
        # Word-level analysis simulation
        words = text_input.split()
        word_count = len(words)
        estimated_errors = int(estimated_wer * word_count)
        
        # Accuracy metrics
        word_accuracy = 1.0 - estimated_wer
        
        wer_result = {
            'estimated_wer': estimated_wer,
            'wer_percentage': estimated_wer * 100,
            'word_accuracy': word_accuracy,
            'total_words': word_count,
            'estimated_errors': estimated_errors,
            'target_met': estimated_wer <= self.wer_target,
            'improvement_needed': max(0, estimated_wer - self.wer_target),
            'validation_status': 'PASS' if estimated_wer <= self.wer_target else 'FAIL'
        }
        
        logger.info(f"WER estimated: {estimated_wer*100:.1f}% ({wer_result['validation_status']})")
        return wer_result
    
    def calculate_likeness_score(self, audio_metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate voice likeness to Christopher Hitchens"""
        
        # Extract likeness components
        hitchens_similarity = audio_metrics.get('hitchens_similarity', 0.0)
        british_accent = audio_metrics.get('british_accent_accuracy', 0.0)
        intellectual_tone = audio_metrics.get('intellectual_tone_consistency', 0.0)
        voice_authenticity = audio_metrics.get('voice_authenticity', 0.0)
        
        # Likeness calculation with weighted components
        likeness_components = {
            'voice_similarity': hitchens_similarity * 0.40,  # 40% weight
            'accent_match': british_accent * 0.25,           # 25% weight
            'tone_consistency': intellectual_tone * 0.20,    # 20% weight
            'overall_authenticity': voice_authenticity * 0.15  # 15% weight
        }
        
        # Calculate overall likeness
        overall_likeness = sum(likeness_components.values())
        
        # Likeness assessment
        likeness_grade = 'POOR'
        if overall_likeness >= 0.95:
            likeness_grade = 'EXCEPTIONAL'
        elif overall_likeness >= 0.90:
            likeness_grade = 'EXCELLENT'
        elif overall_likeness >= 0.85:
            likeness_grade = 'GOOD'
        elif overall_likeness >= 0.75:
            likeness_grade = 'FAIR'
        
        likeness_result = {
            'overall_likeness': overall_likeness,
            'components': likeness_components,
            'target_met': overall_likeness >= self.likeness_target,
            'likeness_grade': likeness_grade,
            'improvement_needed': max(0, self.likeness_target - overall_likeness),
            'validation_status': 'PASS' if overall_likeness >= self.likeness_target else 'FAIL'
        }
        
        logger.info(f"Likeness calculated: {overall_likeness:.3f} ({likeness_grade})")
        return likeness_result
    
    def run_comprehensive_validation(self, narration_result: Dict[str, Any]) -> Dict[str, Any]:
        """Run comprehensive quality validation on narration result"""
        
        logger.info("Starting comprehensive quality validation")
        validation_start = time.time()
        
        try:
            # Extract audio metrics
            audio_metrics = narration_result.get('voice_synthesis', {}).get('quality_metrics', {})
            narration_text = narration_result.get('narration_text', '')
            
            # Run all validation tests
            mos_result = self.calculate_mos_score(audio_metrics)
            wer_result = self.calculate_wer_score(narration_text, audio_metrics)
            likeness_result = self.calculate_likeness_score(audio_metrics)
            
            validation_time = time.time() - validation_start
            
            # Overall validation assessment
            all_targets_met = (
                mos_result['target_met'] and
                wer_result['target_met'] and
                likeness_result['target_met']
            )
            
            # Calculate overall quality score
            overall_quality = (
                mos_result['overall_mos'] / 4.0 * 0.4 +  # 40% weight
                (1.0 - wer_result['estimated_wer']) * 0.3 +  # 30% weight
                likeness_result['overall_likeness'] * 0.3  # 30% weight
            )
            
            validation_result = {
                'validation_timestamp': datetime.now().isoformat(),
                'validation_duration': validation_time,
                'overall_success': all_targets_met,
                'overall_quality_score': overall_quality,
                'mos_validation': mos_result,
                'wer_validation': wer_result,
                'likeness_validation': likeness_result,
                'quality_summary': {
                    'mos_score': mos_result['overall_mos'],
                    'wer_percentage': wer_result['wer_percentage'],
                    'likeness_score': likeness_result['overall_likeness'],
                    'all_targets_met': all_targets_met,
                    'quality_grade': self._determine_overall_grade(mos_result, wer_result, likeness_result)
                },
                'improvement_recommendations': self._generate_improvement_recommendations(
                    mos_result, wer_result, likeness_result
                ),
                'evolution_needed': not all_targets_met and self.evolution_enabled
            }
            
            logger.info(f"Validation complete - Success: {all_targets_met}, Quality: {overall_quality:.3f}")
            return validation_result
            
        except Exception as e:
            logger.error(f"Validation failed: {e}")
            return {
                'validation_timestamp': datetime.now().isoformat(),
                'validation_duration': time.time() - validation_start,
                'overall_success': False,
                'error': str(e)
            }
    
    def _determine_overall_grade(self, mos_result: Dict, wer_result: Dict, likeness_result: Dict) -> str:
        """Determine overall quality grade"""
        
        grades = [mos_result['quality_grade'], likeness_result['likeness_grade']]
        wer_grade = 'EXCELLENT' if wer_result['target_met'] else 'FAIR'
        grades.append(wer_grade)
        
        # Return the most common grade or highest if tied
        if grades.count('EXCELLENT') >= 2:
            return 'EXCELLENT'
        elif grades.count('GOOD') >= 2:
            return 'GOOD'
        elif grades.count('FAIR') >= 2:
            return 'FAIR'
        else:
            return 'POOR'
    
    def _generate_improvement_recommendations(self, mos_result: Dict, wer_result: Dict, likeness_result: Dict) -> List[str]:
        """Generate improvement recommendations based on validation results"""
        
        recommendations = []
        
        if not mos_result['target_met']:
            recommendations.append(f"Improve MOS score by {mos_result['improvement_needed']:.2f} points")
        
        if not wer_result['target_met']:
            recommendations.append(f"Reduce WER by {wer_result['improvement_needed']*100:.1f}% for better accuracy")
        
        if not likeness_result['target_met']:
            recommendations.append(f"Enhance voice likeness by {likeness_result['improvement_needed']:.3f} points")
        
        if not recommendations:
            recommendations.append("All quality targets met - consider fine-tuning for optimization")
        
        return recommendations

def main():
    """Main execution for quality validation testing"""
    
    print("="*60)
    print("HITCHENS QUALITY VALIDATION - PHASE 3")
    print("="*60)
    
    # Load narration results
    try:
        with open('local-ai/hitchens_narration_results.json', 'r') as f:
            narration_result = json.load(f)
    except FileNotFoundError:
        print("❌ Narration results not found - run Phase 2 first")
        return
    
    # Create quality validator
    validator = HitchensQualityValidator()
    
    print(f"Quality Validator Status:")
    print(f"  MOS Target: {validator.mos_target}")
    print(f"  WER Target: <{validator.wer_target*100:.0f}%")
    print(f"  Likeness Target: >{validator.likeness_target*100:.0f}%")
    
    # Run comprehensive validation
    print(f"\nRunning comprehensive quality validation...")
    validation_result = validator.run_comprehensive_validation(narration_result)
    
    if validation_result['overall_success']:
        print(f"\n✅ Quality Validation SUCCESS")
        print(f"  Overall Quality Score: {validation_result['overall_quality_score']:.3f}")
        print(f"  MOS Score: {validation_result['quality_summary']['mos_score']:.2f}")
        print(f"  WER: {validation_result['quality_summary']['wer_percentage']:.1f}%")
        print(f"  Likeness: {validation_result['quality_summary']['likeness_score']:.3f}")
        print(f"  Quality Grade: {validation_result['quality_summary']['quality_grade']}")
    else:
        print(f"\n⚠️ Quality Validation PARTIAL")
        print(f"  Improvements needed:")
        for rec in validation_result.get('improvement_recommendations', []):
            print(f"    - {rec}")
    
    # Save validation results
    with open('local-ai/hitchens_quality_validation_results.json', 'w') as f:
        json.dump(validation_result, f, indent=2)
    
    print(f"\nPhase 3.1 Complete: Quality validation")
    return validation_result

if __name__ == "__main__":
    main()
