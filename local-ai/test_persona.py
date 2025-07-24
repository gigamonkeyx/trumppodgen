#!/usr/bin/env python3
"""
Simple test for Hitchens persona functionality
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from persona_hitchens import HitchensPersonaAgent
    
    # Test basic persona agent
    agent = HitchensPersonaAgent('test_1', 'hitchens_debater', {
        'characteristics': ['intellectual', 'contrarian'],
        'stylistic_markers': {'sardonic_phrases': ['How charming']}
    })
    
    # Test debate response
    task = {'type': 'debate', 'topic': 'religion'}
    result = agent.generate_hitchens_perspective(task)
    fitness = agent.calculate_persona_fitness(result)
    
    print("="*60)
    print("HITCHENS PERSONA TEST - PHASE 2.1")
    print("="*60)
    print(f"Agent ID: {agent.agent_id}")
    print(f"Role: {agent.role}")
    print(f"Task Type: {task['type']}")
    print(f"Topic: {task['topic']}")
    print(f"Result: {result}")
    print(f"Fitness Score: {fitness:.3f}")
    print(f"Confidence: {agent.confidence_score:.3f}")
    
    # Test essay response
    essay_task = {'type': 'essay', 'topic': 'truth and evidence'}
    essay_result = agent.generate_hitchens_perspective(essay_task)
    essay_fitness = agent.calculate_persona_fitness(essay_result)
    
    print(f"\nEssay Test:")
    print(f"Topic: {essay_task['topic']}")
    print(f"Result: {essay_result}")
    print(f"Fitness Score: {essay_fitness:.3f}")
    
    # Verify fitness threshold
    avg_fitness = (fitness + essay_fitness) / 2
    threshold_met = avg_fitness >= 0.70
    
    print(f"\nFitness Analysis:")
    print(f"Average Fitness: {avg_fitness:.3f}")
    print(f"Threshold (>0.70): {'✅ PASSED' if threshold_met else '❌ FAILED'}")
    print(f"Phase 2.1 Status: {'COMPLETE' if threshold_met else 'NEEDS IMPROVEMENT'}")
    
except Exception as e:
    print(f"Error in persona test: {e}")
    import traceback
    traceback.print_exc()
