#!/usr/bin/env python3
"""
Audio RL Optimizer - Phase 4
RL-reward system for Hitchens audio quality optimization with MCP-sync
"""

import json
import time
from datetime import datetime
from typing import Dict, List, Any
import logging
from rl_reward import RLRewardSystem
from persona_mcp_sync import PersonaMCPSync

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AudioRLOptimizer:
    """RL-reward system for audio quality optimization with MCP-sync integration"""
    
    def __init__(self):
        self.rl_system = RLRewardSystem()
        self.mcp_sync = PersonaMCPSync(refresh_interval=30)  # 30s for audio testing
        
        # Audio-specific reward parameters
        self.audio_quality_baseline = 0.956  # From quality validation
        self.mos_baseline = 3.91
        self.wer_baseline = 0.063
        self.likeness_baseline = 0.947
        
        # Optimization targets
        self.target_improvement = 1.05  # 5% improvement target
        self.quality_threshold = 0.70
        
        logger.info("Audio RL optimizer initialized")
    
    def calculate_audio_reward(self, audio_result: Dict[str, Any], quality_context: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate RL reward for audio quality optimization"""
        
        # Extract quality metrics
        mos_score = audio_result.get('mos_score', 0.0)
        wer_score = 1.0 - audio_result.get('wer_percentage', 100.0) / 100.0  # Convert to accuracy
        likeness_score = audio_result.get('likeness_score', 0.0)
        overall_quality = audio_result.get('overall_quality_score', 0.0)
        
        # Calculate reward components
        reward_components = {
            'mos_reward': self._calculate_mos_reward(mos_score),
            'wer_reward': self._calculate_wer_reward(wer_score),
            'likeness_reward': self._calculate_likeness_reward(likeness_score),
            'quality_reward': self._calculate_quality_reward(overall_quality),
            'improvement_bonus': self._calculate_improvement_bonus(overall_quality)
        }
        
        # Total reward calculation
        total_reward = sum(reward_components.values())
        
        # Apply multipliers for exceptional performance
        if mos_score >= 4.1 and likeness_score >= 0.95:
            total_reward *= 1.15  # 15% bonus for dual excellence
        elif mos_score >= 4.0 or likeness_score >= 0.90:
            total_reward *= 1.08  # 8% bonus for single excellence
        
        reward_result = {
            'total_reward': min(2.0, total_reward),  # Cap at 2.0
            'components': reward_components,
            'baseline_comparison': {
                'mos_improvement': (mos_score - self.mos_baseline) / self.mos_baseline,
                'wer_improvement': (wer_score - (1.0 - self.wer_baseline)) / (1.0 - self.wer_baseline),
                'likeness_improvement': (likeness_score - self.likeness_baseline) / self.likeness_baseline,
                'overall_improvement': (overall_quality - self.audio_quality_baseline) / self.audio_quality_baseline
            },
            'performance_grade': self._determine_performance_grade(total_reward),
            'optimization_success': total_reward >= 1.0
        }
        
        logger.info(f"Audio reward calculated: {total_reward:.3f} ({reward_result['performance_grade']})")
        return reward_result
    
    def _calculate_mos_reward(self, mos_score: float) -> float:
        """Calculate MOS-specific reward component"""
        # Reward based on MOS score with 4.1 target
        if mos_score >= 4.1:
            return 0.4 + (mos_score - 4.1) * 0.5  # Bonus for exceeding target
        else:
            return 0.4 * (mos_score / 4.1)  # Proportional reward
    
    def _calculate_wer_reward(self, wer_accuracy: float) -> float:
        """Calculate WER-specific reward component"""
        # Reward based on WER accuracy (higher is better)
        target_accuracy = 0.89  # 11% WER = 89% accuracy
        if wer_accuracy >= target_accuracy:
            return 0.25 + (wer_accuracy - target_accuracy) * 0.5  # Bonus for exceeding target
        else:
            return 0.25 * (wer_accuracy / target_accuracy)  # Proportional reward
    
    def _calculate_likeness_reward(self, likeness_score: float) -> float:
        """Calculate likeness-specific reward component"""
        # Reward based on voice likeness with 0.95 target
        if likeness_score >= 0.95:
            return 0.25 + (likeness_score - 0.95) * 1.0  # Bonus for exceeding target
        else:
            return 0.25 * (likeness_score / 0.95)  # Proportional reward
    
    def _calculate_quality_reward(self, overall_quality: float) -> float:
        """Calculate overall quality reward component"""
        # Reward based on overall quality score
        return 0.1 * overall_quality  # 10% weight for overall quality
    
    def _calculate_improvement_bonus(self, overall_quality: float) -> float:
        """Calculate improvement bonus over baseline"""
        improvement_ratio = overall_quality / self.audio_quality_baseline
        if improvement_ratio >= self.target_improvement:
            return 0.1 * (improvement_ratio - 1.0)  # Bonus for improvement
        else:
            return 0.0
    
    def _determine_performance_grade(self, total_reward: float) -> str:
        """Determine performance grade based on total reward"""
        if total_reward >= 1.5:
            return 'EXCEPTIONAL'
        elif total_reward >= 1.2:
            return 'EXCELLENT'
        elif total_reward >= 1.0:
            return 'GOOD'
        elif total_reward >= 0.8:
            return 'FAIR'
        else:
            return 'POOR'
    
    def run_audio_optimization_cycle(self, validation_result: Dict[str, Any]) -> Dict[str, Any]:
        """Run complete audio optimization cycle with RL rewards and MCP-sync"""
        
        logger.info("Starting audio optimization cycle")
        cycle_start = time.time()
        
        try:
            # Extract quality summary from validation result
            quality_summary = validation_result.get('quality_summary', {})
            
            # Calculate RL reward for current audio quality
            audio_reward = self.calculate_audio_reward(quality_summary, {})
            
            # Run MCP-sync for tool discovery and refresh
            mcp_results = self.mcp_sync.refresh_persona_content()
            discovered_tools = self.mcp_sync.discover_heavy_tools()
            
            # Track optimization metrics
            cycle_time = time.time() - cycle_start
            
            optimization_result = {
                'optimization_timestamp': datetime.now().isoformat(),
                'cycle_duration': cycle_time,
                'rl_reward_results': audio_reward,
                'mcp_sync_results': {
                    'refresh_status': mcp_results.get('status', 'unknown'),
                    'tools_discovered': len(discovered_tools),
                    'refresh_time': mcp_results.get('refresh_time_seconds', 0.0)
                },
                'optimization_metrics': {
                    'current_quality_score': quality_summary.get('overall_quality_score', 0.0),
                    'baseline_quality_score': self.audio_quality_baseline,
                    'improvement_achieved': audio_reward['baseline_comparison']['overall_improvement'],
                    'target_improvement_met': audio_reward['baseline_comparison']['overall_improvement'] >= (self.target_improvement - 1.0),
                    'optimization_success': audio_reward['optimization_success']
                },
                'quality_breakdown': {
                    'mos_performance': {
                        'current': quality_summary.get('mos_score', 0.0),
                        'baseline': self.mos_baseline,
                        'improvement': audio_reward['baseline_comparison']['mos_improvement']
                    },
                    'wer_performance': {
                        'current': quality_summary.get('wer_percentage', 100.0),
                        'baseline': self.wer_baseline * 100,
                        'improvement': audio_reward['baseline_comparison']['wer_improvement']
                    },
                    'likeness_performance': {
                        'current': quality_summary.get('likeness_score', 0.0),
                        'baseline': self.likeness_baseline,
                        'improvement': audio_reward['baseline_comparison']['likeness_improvement']
                    }
                },
                'system_status': {
                    'rl_system_active': True,
                    'mcp_sync_operational': mcp_results.get('status') in ['success', 'skipped'],
                    'quality_threshold_maintained': quality_summary.get('overall_quality_score', 0.0) >= self.quality_threshold,
                    'tools_available': len(discovered_tools)
                }
            }
            
            # Overall optimization assessment
            optimization_success = (
                audio_reward['optimization_success'] and
                optimization_result['system_status']['mcp_sync_operational'] and
                optimization_result['system_status']['quality_threshold_maintained']
            )
            
            optimization_result['overall_optimization_success'] = optimization_success
            
            logger.info(f"Optimization cycle complete - Success: {optimization_success}")
            return optimization_result
            
        except Exception as e:
            logger.error(f"Optimization cycle failed: {e}")
            return {
                'optimization_timestamp': datetime.now().isoformat(),
                'cycle_duration': time.time() - cycle_start,
                'error': str(e),
                'overall_optimization_success': False
            }

def main():
    """Main execution for audio RL optimization"""
    
    print("="*60)
    print("AUDIO RL OPTIMIZATION - PHASE 4")
    print("="*60)
    
    # Load quality validation results
    try:
        with open('local-ai/hitchens_quality_validation_results.json', 'r') as f:
            validation_result = json.load(f)
    except FileNotFoundError:
        print("❌ Quality validation results not found - run Phase 3 first")
        return
    
    # Create audio RL optimizer
    optimizer = AudioRLOptimizer()
    
    print(f"Audio RL Optimizer Status:")
    print(f"  Quality Baseline: {optimizer.audio_quality_baseline:.3f}")
    print(f"  MOS Baseline: {optimizer.mos_baseline}")
    print(f"  Target Improvement: {optimizer.target_improvement}x")
    
    # Run optimization cycle
    print(f"\nRunning audio optimization cycle...")
    optimization_result = optimizer.run_audio_optimization_cycle(validation_result)
    
    if optimization_result['overall_optimization_success']:
        print(f"\n✅ Audio Optimization SUCCESS")
        print(f"  RL Reward: {optimization_result['rl_reward_results']['total_reward']:.3f}")
        print(f"  Performance Grade: {optimization_result['rl_reward_results']['performance_grade']}")
        print(f"  Quality Improvement: {optimization_result['optimization_metrics']['improvement_achieved']*100:.1f}%")
        print(f"  MCP Tools: {optimization_result['mcp_sync_results']['tools_discovered']}")
    else:
        print(f"\n⚠️ Audio Optimization PARTIAL")
        print(f"  Current Quality: {optimization_result['optimization_metrics']['current_quality_score']:.3f}")
        print(f"  Baseline Quality: {optimization_result['optimization_metrics']['baseline_quality_score']:.3f}")
    
    # Save optimization results
    with open('local-ai/audio_rl_optimization_results.json', 'w') as f:
        json.dump(optimization_result, f, indent=2)
    
    print(f"\nPhase 4.1 Complete: Audio RL optimization")
    return optimization_result

if __name__ == "__main__":
    main()
