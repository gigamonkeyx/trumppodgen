#!/usr/bin/env python3
"""
Evolution Trainer for Heavy Mode Swarm
Implements evolutionary optimization with fitness >70% threshold
"""

import asyncio
import json
import random
import time
from typing import Dict, List, Any, Tuple
from datetime import datetime
import logging
from swarm_sim import RIPERSwarmSimulation

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EvolutionTrainer:
    """Evolutionary trainer for swarm optimization with MCP integration"""
    
    def __init__(self, population_size: int = 5, fitness_threshold: float = 0.70):
        self.population_size = population_size
        self.fitness_threshold = fitness_threshold
        self.generation = 0
        self.population: List[Dict[str, Any]] = []
        self.best_individual = None
        self.evolution_history = []
        
    def initialize_population(self) -> List[Dict[str, Any]]:
        """Initialize population of swarm configurations"""
        population = []
        
        for i in range(self.population_size):
            individual = {
                'id': f"swarm_gen0_{i}",
                'config': {
                    'agent_count': random.randint(6, 12),
                    'heavy_mode': True,
                    'collaboration_threshold': random.uniform(0.5, 0.9),
                    'specialization_depth': random.uniform(0.6, 1.0),
                    'parallel_processing_factor': random.uniform(1.2, 2.0)
                },
                'fitness': 0.0,
                'performance_metrics': {},
                'generation': 0
            }
            population.append(individual)
            
        self.population = population
        logger.info(f"Initialized population of {len(population)} individuals")
        return population
    
    async def evaluate_fitness(self, individual: Dict[str, Any]) -> float:
        """Evaluate fitness of swarm configuration"""
        try:
            # Create swarm with individual's configuration
            swarm = RIPERSwarmSimulation(
                initial_agent_count=individual['config']['agent_count'],
                heavy_mode=individual['config']['heavy_mode']
            )
            
            # Test tasks for fitness evaluation
            test_tasks = [
                {
                    'id': 'codebase_ingestion_test',
                    'type': 'ingestion',
                    'requirements': ['codebase_analysis', 'file_parsing'],
                    'complexity': 0.8,
                    'expected_output_quality': 0.75
                },
                {
                    'id': 'workflow_simulation_test', 
                    'type': 'simulation',
                    'requirements': ['process_modeling', 'execution_paths'],
                    'complexity': 0.7,
                    'expected_output_quality': 0.70
                },
                {
                    'id': 'tts_optimization_test',
                    'type': 'optimization',
                    'requirements': ['audio_processing', 'gpu_acceleration'],
                    'complexity': 0.9,
                    'expected_output_quality': 0.80
                }
            ]
            
            total_fitness = 0.0
            task_results = []
            
            for task in test_tasks:
                start_time = time.time()
                result = await swarm.process_task_swarm(task)
                completion_time = time.time() - start_time
                
                # Calculate task fitness
                confidence = result.get('result', {}).get('confidence', 0.0)
                speed_factor = max(0.1, 1.0 - (completion_time / 10.0))  # Penalty for slow tasks
                quality_score = confidence * speed_factor
                
                task_fitness = min(1.0, quality_score / task['expected_output_quality'])
                total_fitness += task_fitness
                
                task_results.append({
                    'task_id': task['id'],
                    'confidence': confidence,
                    'completion_time': completion_time,
                    'fitness': task_fitness
                })
            
            # Average fitness across all tasks
            average_fitness = total_fitness / len(test_tasks)
            
            # Store performance metrics
            individual['performance_metrics'] = {
                'task_results': task_results,
                'average_fitness': average_fitness,
                'total_agents': len(swarm.agents),
                'successful_collaborations': swarm.simulation_metrics['successful_collaborations'],
                'evaluation_timestamp': datetime.now().isoformat()
            }
            
            logger.info(f"Individual {individual['id']} fitness: {average_fitness:.3f}")
            return average_fitness
            
        except Exception as e:
            logger.error(f"Fitness evaluation failed for {individual['id']}: {e}")
            return 0.0
    
    def mutate_individual(self, individual: Dict[str, Any]) -> Dict[str, Any]:
        """Mutate individual configuration"""
        mutated = individual.copy()
        mutated['id'] = f"swarm_gen{self.generation+1}_{random.randint(1000, 9999)}"
        mutated['generation'] = self.generation + 1
        
        config = mutated['config'].copy()
        
        # Mutate parameters with small random changes
        if random.random() < 0.3:
            config['agent_count'] = max(4, min(15, config['agent_count'] + random.randint(-2, 2)))
        
        if random.random() < 0.4:
            config['collaboration_threshold'] += random.uniform(-0.1, 0.1)
            config['collaboration_threshold'] = max(0.3, min(0.95, config['collaboration_threshold']))
        
        if random.random() < 0.4:
            config['specialization_depth'] += random.uniform(-0.15, 0.15)
            config['specialization_depth'] = max(0.4, min(1.0, config['specialization_depth']))
        
        if random.random() < 0.3:
            config['parallel_processing_factor'] += random.uniform(-0.2, 0.2)
            config['parallel_processing_factor'] = max(1.0, min(3.0, config['parallel_processing_factor']))
        
        mutated['config'] = config
        mutated['fitness'] = 0.0  # Reset fitness
        
        return mutated
    
    def crossover(self, parent1: Dict[str, Any], parent2: Dict[str, Any]) -> Dict[str, Any]:
        """Create offspring through crossover"""
        offspring = {
            'id': f"swarm_gen{self.generation+1}_cross_{random.randint(1000, 9999)}",
            'generation': self.generation + 1,
            'config': {},
            'fitness': 0.0,
            'performance_metrics': {}
        }
        
        # Mix configurations from both parents
        config1, config2 = parent1['config'], parent2['config']
        
        offspring['config'] = {
            'agent_count': random.choice([config1['agent_count'], config2['agent_count']]),
            'heavy_mode': True,  # Always keep heavy mode
            'collaboration_threshold': (config1['collaboration_threshold'] + config2['collaboration_threshold']) / 2,
            'specialization_depth': random.choice([config1['specialization_depth'], config2['specialization_depth']]),
            'parallel_processing_factor': (config1['parallel_processing_factor'] + config2['parallel_processing_factor']) / 2
        }
        
        return offspring
    
    async def evolve_generation(self) -> Dict[str, Any]:
        """Evolve one generation"""
        logger.info(f"Evolving generation {self.generation}")
        
        # Evaluate fitness for all individuals
        for individual in self.population:
            if individual['fitness'] == 0.0:  # Only evaluate if not already done
                individual['fitness'] = await self.evaluate_fitness(individual)
        
        # Sort by fitness (descending)
        self.population.sort(key=lambda x: x['fitness'], reverse=True)
        
        # Track best individual
        if not self.best_individual or self.population[0]['fitness'] > self.best_individual['fitness']:
            self.best_individual = self.population[0].copy()
            logger.info(f"New best individual: {self.best_individual['id']} with fitness {self.best_individual['fitness']:.3f}")
        
        # Check if we've reached the fitness threshold
        if self.population[0]['fitness'] >= self.fitness_threshold:
            logger.info(f"Fitness threshold {self.fitness_threshold} reached!")
            return {
                'generation': self.generation,
                'best_fitness': self.population[0]['fitness'],
                'threshold_reached': True,
                'best_individual': self.best_individual
            }
        
        # Create next generation
        next_generation = []
        
        # Keep top 20% (elitism)
        elite_count = max(1, int(0.2 * self.population_size))
        next_generation.extend(self.population[:elite_count])
        
        # Generate offspring through crossover and mutation
        while len(next_generation) < self.population_size:
            if random.random() < 0.7:  # 70% crossover
                parent1 = random.choice(self.population[:int(0.5 * self.population_size)])
                parent2 = random.choice(self.population[:int(0.5 * self.population_size)])
                offspring = self.crossover(parent1, parent2)
            else:  # 30% mutation
                parent = random.choice(self.population[:int(0.6 * self.population_size)])
                offspring = self.mutate_individual(parent)
            
            next_generation.append(offspring)
        
        self.population = next_generation
        self.generation += 1
        
        return {
            'generation': self.generation,
            'best_fitness': self.population[0]['fitness'],
            'threshold_reached': False,
            'population_size': len(self.population)
        }

async def run_evolution_training():
    """Run evolution training loop"""
    trainer = EvolutionTrainer(population_size=5, fitness_threshold=0.70)
    trainer.initialize_population()
    
    max_generations = 10
    for gen in range(max_generations):
        result = await trainer.evolve_generation()
        
        logger.info(f"Generation {result['generation']}: Best fitness = {result['best_fitness']:.3f}")
        
        if result['threshold_reached']:
            logger.info("Evolution training completed successfully!")
            break
    
    return trainer.best_individual

if __name__ == "__main__":
    asyncio.run(run_evolution_training())
