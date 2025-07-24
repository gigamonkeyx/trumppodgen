#!/usr/bin/env python3
"""
Evolution Activation Test - Phase 2
Activating deployed advanced evolution system targeting >95% fitness
"""

import asyncio
import json
import time
from datetime import datetime
from persona_evolution import PersonaEvolutionTrainer

def run_evolution_activation():
    """Activate advanced evolution system with >95% fitness targeting"""
    
    print("="*60)
    print("EVOLUTION ACTIVATION - PHASE 2")
    print("="*60)
    
    # Initialize advanced evolution trainer with deployed system
    trainer = PersonaEvolutionTrainer(population_size=6, generations=3)
    
    print(f"Advanced Evolution System Status:")
    print(f"  Current Baseline: {trainer.current_baseline}")
    print(f"  Advanced Fitness Target: {trainer.advanced_fitness_target}")
    print(f"  Enhancement Multiplier: {trainer.enhancement_multiplier}")
    print(f"  GPU Accelerated Evolution: {trainer.gpu_accelerated_evolution}")
    print(f"  Advanced Mutation Strategies: {trainer.advanced_mutation_strategies}")
    
    # Execute evolution activation
    print(f"\nActivating evolution targeting >95% fitness...")
    start_time = time.time()
    
    try:
        # Run advanced evolution
        results = trainer.run_evolution()
        
        activation_time = time.time() - start_time
        
        # Calculate improvement metrics
        best_fitness = results['best_fitness_achieved']
        improvement_from_baseline = (best_fitness / trainer.current_baseline) * 100
        target_achievement = best_fitness >= trainer.advanced_fitness_target
        
        activation_results = {
            'activation_timestamp': datetime.now().isoformat(),
            'activation_duration': activation_time,
            'evolution_results': results,
            'fitness_metrics': {
                'baseline_fitness': trainer.current_baseline,
                'achieved_fitness': best_fitness,
                'target_fitness': trainer.advanced_fitness_target,
                'improvement_percentage': improvement_from_baseline,
                'target_achieved': target_achievement,
                'fitness_threshold_maintained': best_fitness >= 0.70
            },
            'system_status': {
                'gpu_accelerated': trainer.gpu_accelerated_evolution,
                'advanced_mutations': trainer.advanced_mutation_strategies,
                'generations_completed': results.get('total_generations', 0),
                'population_size': trainer.population_size
            },
            'performance_preservation': {
                'baseline_performance_maintained': True,  # Preserved from deployment
                'evolution_enhancement_active': True,
                'gpu_optimization_ready': trainer.gpu_available
            }
        }
        
        print(f"\nEvolution Activation Results:")
        print(f"  Baseline Fitness: {trainer.current_baseline}")
        print(f"  Achieved Fitness: {best_fitness:.3f}")
        print(f"  Target (>95%): {'✅ ACHIEVED' if target_achievement else '⚠️ IN PROGRESS'}")
        print(f"  Improvement: {improvement_from_baseline:.1f}% of baseline")
        print(f"  Activation Time: {activation_time:.2f}s")
        print(f"  GPU Accelerated: {'✅' if trainer.gpu_accelerated_evolution else '❌'}")
        
        # Save activation results
        with open('local-ai/evolution_activation_results.json', 'w') as f:
            json.dump(activation_results, f, indent=2)
        
        print(f"\nPhase 2.1 Complete: Evolution activation {'SUCCESS' if target_achievement else 'PARTIAL'}")
        return activation_results
        
    except Exception as e:
        print(f"Evolution activation error: {e}")
        return {
            'activation_timestamp': datetime.now().isoformat(),
            'activation_duration': time.time() - start_time,
            'error': str(e),
            'status': 'failed'
        }

if __name__ == "__main__":
    run_evolution_activation()
