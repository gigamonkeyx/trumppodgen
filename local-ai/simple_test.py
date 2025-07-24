#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

print("Starting simple persona test...")

try:
    from persona_hitchens import HitchensPersonaAgent
    print("Import successful")
    
    agent = HitchensPersonaAgent('test_1', 'hitchens_debater', {
        'characteristics': ['intellectual', 'contrarian'],
        'stylistic_markers': {'sardonic_phrases': ['How charming']}
    })
    print(f"Agent created: {agent.agent_id}")
    
    task = {'type': 'debate', 'topic': 'religion'}
    result = agent.generate_hitchens_perspective(task)
    print(f"Generated result: {result}")
    
    fitness = agent.calculate_persona_fitness(result)
    print(f"Fitness: {fitness:.3f}")
    
    if fitness >= 0.70:
        print("✅ FITNESS THRESHOLD MET")
        print("Phase 2 Complete")
    else:
        print("❌ FITNESS BELOW THRESHOLD")
        print("Phase 2 Needs Improvement")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

print("Test complete")
