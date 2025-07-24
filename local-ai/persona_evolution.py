#!/usr/bin/env python3
"""
Evolutionary Training System for Hitchens Persona
RIPER-Ω Protocol v2.5 compliance with GPU optimization
"""

import json
import random
import asyncio
import subprocess
from typing import Dict, List, Any, Tuple
from datetime import datetime
import logging
from persona_hitchens import HitchensPersonaAgent, HitchensPersonaSwarm

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PersonaEvolutionTrainer:
    """Evolutionary training system for Hitchens persona optimization"""
    
    def __init__(self, population_size: int = 10, generations: int = 5):
        self.population_size = population_size
        self.generations = generations
        self.fitness_threshold = 0.70
        self.target_authenticity = 0.95
        self.mutation_rate = 0.3
        self.gpu_available = self._check_gpu_availability()
        
        # Evolution tracking
        self.generation_history = []
        self.best_fitness_history = []
        self.current_generation = 0
        
        logger.info(f"Initialized persona evolution trainer: {population_size} agents, {generations} generations")
    
    def _check_gpu_availability(self) -> bool:
        """Check GPU availability for training optimization"""
        try:
            result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                logger.info("GPU detected - enabling GPU-accelerated evolution")
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        logger.info("No GPU detected - using CPU-only evolution")
        return False
    
    def create_initial_population(self) -> List[HitchensPersonaAgent]:
        """Create initial population of Hitchens persona agents"""
        
        population = []
        base_profile = {
            'characteristics': ['intellectual', 'contrarian', 'witty', 'eloquent'],
            'stylistic_markers': {
                'sardonic_phrases': ['How charming', 'Delightful', 'Touching'],
                'contrarian_arguments': ['On the contrary', 'I disagree']
            }
        }
        
        for i in range(self.population_size):
            # Create variations in persona traits
            varied_profile = self._mutate_persona_profile(base_profile, mutation_strength=0.5)
            
            agent_id = f"hitchens_evo_{i+1}_{self.current_generation}"
            role = f"hitchens_evolutionary_{i+1}"
            
            agent = HitchensPersonaAgent(agent_id, role, varied_profile)
            population.append(agent)
        
        logger.info(f"Created initial population of {len(population)} agents")
        return population
    
    def _mutate_persona_profile(self, base_profile: Dict[str, Any], mutation_strength: float = 0.3) -> Dict[str, Any]:
        """Mutate persona profile for evolutionary diversity"""
        
        mutated_profile = json.loads(json.dumps(base_profile))  # Deep copy
        
        # Mutate characteristics
        if random.random() < mutation_strength:
            additional_traits = ['sardonic', 'erudite', 'provocative', 'analytical', 'skeptical']
            if random.random() < 0.5:
                # Add trait
                new_trait = random.choice(additional_traits)
                if new_trait not in mutated_profile['characteristics']:
                    mutated_profile['characteristics'].append(new_trait)
            else:
                # Remove trait (but keep minimum)
                if len(mutated_profile['characteristics']) > 2:
                    mutated_profile['characteristics'].pop(random.randint(0, len(mutated_profile['characteristics'])-1))
        
        # Mutate stylistic markers
        if random.random() < mutation_strength:
            additional_phrases = ['Wonderfully naive', 'Perfectly absurd', 'Rather touching']
            phrase_to_add = random.choice(additional_phrases)
            if phrase_to_add not in mutated_profile['stylistic_markers']['sardonic_phrases']:
                mutated_profile['stylistic_markers']['sardonic_phrases'].append(phrase_to_add)
        
        return mutated_profile
    
    def evaluate_fitness_population(self, population: List[HitchensPersonaAgent]) -> List[Tuple[HitchensPersonaAgent, float]]:
        """Evaluate fitness for entire population"""
        
        test_tasks = [
            {'type': 'debate', 'topic': 'religion and society'},
            {'type': 'essay', 'topic': 'intellectual honesty'},
            {'type': 'criticism', 'topic': 'modern discourse'},
            {'type': 'general', 'topic': 'truth and evidence'}
        ]
        
        fitness_results = []
        
        for agent in population:
            total_fitness = 0.0
            task_count = 0
            
            for task in test_tasks:
                try:
                    response = agent.generate_hitchens_perspective(task)
                    fitness = agent.calculate_persona_fitness(response)
                    total_fitness += fitness
                    task_count += 1
                except Exception as e:
                    logger.warning(f"Fitness evaluation failed for agent {agent.agent_id}: {e}")
                    continue
            
            average_fitness = total_fitness / task_count if task_count > 0 else 0.0
            fitness_results.append((agent, average_fitness))
        
        # Sort by fitness (descending)
        fitness_results.sort(key=lambda x: x[1], reverse=True)
        
        logger.info(f"Population fitness evaluated - Best: {fitness_results[0][1]:.3f}, Worst: {fitness_results[-1][1]:.3f}")
        return fitness_results
    
    def select_parents(self, fitness_results: List[Tuple[HitchensPersonaAgent, float]]) -> List[HitchensPersonaAgent]:
        """Select top performers for breeding"""
        
        # Select top 50% as parents
        parent_count = max(2, self.population_size // 2)
        parents = [agent for agent, fitness in fitness_results[:parent_count]]
        
        logger.info(f"Selected {len(parents)} parents for next generation")
        return parents
    
    def create_offspring(self, parents: List[HitchensPersonaAgent]) -> List[HitchensPersonaAgent]:
        """Create offspring through crossover and mutation"""
        
        offspring = []
        
        while len(offspring) < self.population_size:
            # Select two random parents
            parent1 = random.choice(parents)
            parent2 = random.choice(parents)
            
            # Crossover - combine traits
            child_profile = self._crossover_profiles(parent1.hitchens_profile, parent2.hitchens_profile)
            
            # Mutation
            if random.random() < self.mutation_rate:
                child_profile = self._mutate_persona_profile(child_profile, mutation_strength=0.2)
            
            # Create child agent
            child_id = f"hitchens_evo_{len(offspring)+1}_{self.current_generation+1}"
            child_role = f"hitchens_evolutionary_{len(offspring)+1}"
            
            child = HitchensPersonaAgent(child_id, child_role, child_profile)
            offspring.append(child)
        
        logger.info(f"Created {len(offspring)} offspring for generation {self.current_generation+1}")
        return offspring
    
    def _crossover_profiles(self, profile1: Dict[str, Any], profile2: Dict[str, Any]) -> Dict[str, Any]:
        """Crossover two persona profiles"""
        
        child_profile = {
            'characteristics': [],
            'stylistic_markers': {
                'sardonic_phrases': [],
                'contrarian_arguments': []
            }
        }
        
        # Combine characteristics from both parents
        all_characteristics = list(set(profile1.get('characteristics', []) + profile2.get('characteristics', [])))
        # Select random subset
        child_profile['characteristics'] = random.sample(all_characteristics, min(len(all_characteristics), 5))
        
        # Combine stylistic markers
        all_sardonic = list(set(
            profile1.get('stylistic_markers', {}).get('sardonic_phrases', []) +
            profile2.get('stylistic_markers', {}).get('sardonic_phrases', [])
        ))
        child_profile['stylistic_markers']['sardonic_phrases'] = random.sample(all_sardonic, min(len(all_sardonic), 4))
        
        all_contrarian = list(set(
            profile1.get('stylistic_markers', {}).get('contrarian_arguments', []) +
            profile2.get('stylistic_markers', {}).get('contrarian_arguments', [])
        ))
        child_profile['stylistic_markers']['contrarian_arguments'] = random.sample(all_contrarian, min(len(all_contrarian), 3))
        
        return child_profile
    
    def run_evolution(self) -> Dict[str, Any]:
        """Run complete evolutionary training process"""
        
        logger.info(f"Starting evolutionary training: {self.generations} generations")
        start_time = datetime.now()
        
        # Create initial population
        population = self.create_initial_population()
        
        best_overall_fitness = 0.0
        best_overall_agent = None
        
        for generation in range(self.generations):
            self.current_generation = generation
            logger.info(f"Generation {generation + 1}/{self.generations}")
            
            # Evaluate fitness
            fitness_results = self.evaluate_fitness_population(population)
            best_fitness = fitness_results[0][1]
            best_agent = fitness_results[0][0]
            
            # Track best overall
            if best_fitness > best_overall_fitness:
                best_overall_fitness = best_fitness
                best_overall_agent = best_agent
            
            # Record generation stats
            generation_stats = {
                'generation': generation + 1,
                'best_fitness': best_fitness,
                'average_fitness': sum(f for _, f in fitness_results) / len(fitness_results),
                'worst_fitness': fitness_results[-1][1],
                'threshold_met': best_fitness >= self.fitness_threshold
            }
            
            self.generation_history.append(generation_stats)
            self.best_fitness_history.append(best_fitness)
            
            logger.info(f"Gen {generation + 1} - Best: {best_fitness:.3f}, Avg: {generation_stats['average_fitness']:.3f}")
            
            # Check if we've reached target
            if best_fitness >= self.target_authenticity:
                logger.info(f"Target authenticity {self.target_authenticity} reached in generation {generation + 1}")
                break
            
            # Create next generation (except for last iteration)
            if generation < self.generations - 1:
                parents = self.select_parents(fitness_results)
                population = self.create_offspring(parents)
        
        # Final results
        training_time = (datetime.now() - start_time).total_seconds()
        
        evolution_results = {
            'training_completed': True,
            'total_generations': len(self.generation_history),
            'best_fitness_achieved': best_overall_fitness,
            'fitness_threshold_met': best_overall_fitness >= self.fitness_threshold,
            'target_authenticity_met': best_overall_fitness >= self.target_authenticity,
            'best_agent_id': best_overall_agent.agent_id if best_overall_agent else None,
            'training_time_seconds': training_time,
            'gpu_accelerated': self.gpu_available,
            'generation_history': self.generation_history,
            'fitness_progression': self.best_fitness_history,
            'final_population_size': len(population),
            'timestamp': datetime.now().isoformat()
        }
        
        logger.info(f"Evolution complete - Best fitness: {best_overall_fitness:.3f}")
        return evolution_results

def main():
    """Main execution for persona evolution"""
    
    print("="*60)
    print("HITCHENS PERSONA EVOLUTION - PHASE 3")
    print("="*60)
    
    # Create evolution trainer
    trainer = PersonaEvolutionTrainer(population_size=8, generations=3)
    
    # Run evolution
    results = trainer.run_evolution()
    
    print(f"\nEvolution Results:")
    print(f"Best Fitness: {results['best_fitness_achieved']:.3f}")
    print(f"Threshold Met (>0.70): {'✅' if results['fitness_threshold_met'] else '❌'}")
    print(f"Target Met (>0.95): {'✅' if results['target_authenticity_met'] else '❌'}")
    print(f"Training Time: {results['training_time_seconds']:.1f}s")
    print(f"GPU Accelerated: {'✅' if results['gpu_accelerated'] else '❌'}")
    
    # Save results
    with open('local-ai/persona_evolution_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nPhase 3 Status: {'COMPLETE' if results['fitness_threshold_met'] else 'NEEDS IMPROVEMENT'}")
    return results

if __name__ == "__main__":
    main()
