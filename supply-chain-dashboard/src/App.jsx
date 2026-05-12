import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';

// ============================================================================
// DATA MODEL & SCHEMA
// ============================================================================

const INITIAL_DATA = {
  rawMaterials: [
    { id: 'RM_01', name: 'Stainless Steel Housing', source: 'Germany', cost: 2.00, capacity: 10000, currentCapacity: 10000 },
    { id: 'RM_02', name: 'Raw Silicon Wafers', source: 'China', cost: 0.50, capacity: 50000, currentCapacity: 50000 },
  ],
  tier1Components: [
    { id: 'C_01', name: '10k NTC Thermistor', source: 'China', cost: 1.50, consumes: { RM_02: 1 }, capacity: 20000, currentCapacity: 20000 },
    { id: 'C_02', name: 'Microcontroller/ASIC', source: 'USA', cost: 4.00, consumes: {}, capacity: 15000, currentCapacity: 15000 },
    { id: 'C_03', name: 'Printed Circuit Board', source: 'Taiwan', cost: 1.20, consumes: {}, capacity: 18000, currentCapacity: 18000 },
    { id: 'C_04', name: '4-20mA Output Transmitter', source: 'Japan', cost: 3.00, consumes: {}, capacity: 16000, currentCapacity: 16000 },
  ],
  oemAssembly: [
    { id: 'OEM_Primary', name: 'Sensor Assembly Plant', location: 'Mexico', assemblyCost: 5.00, requires: { RM_01: 1, C_01: 1, C_02: 1, C_03: 1, C_04: 1 }, capacity: 12000, currentCapacity: 12000 },
    { id: 'OEM_Backup', name: 'Sensor Assembly Plant (Backup)', location: 'Vietnam', assemblyCost: 4.50, requires: { RM_01: 1, C_01: 1, C_02: 1, C_03: 1, C_04: 1 }, capacity: 8000, currentCapacity: 8000 },
  ],
  markets: [
    { id: 'M_US', name: 'United States', demand: 5000, price: 45.00 },
    { id: 'M_EU', name: 'Europe', demand: 3000, price: 50.00 },
  ],
};

const TARIFF_LANES = [
  { id: 'china-mexico', from: 'China', to: 'Mexico', baseRate: 0 },
  { id: 'china-vietnam', from: 'China', to: 'Vietnam', baseRate: 0 },
  { id: 'germany-mexico', from: 'Germany', to: 'Mexico', baseRate: 0 },
  { id: 'germany-vietnam', from: 'Germany', to: 'Vietnam', baseRate: 0 },
  { id: 'usa-mexico', from: 'USA', to: 'Mexico', baseRate: 0 },
  { id: 'usa-vietnam', from: 'USA', to: 'Vietnam', baseRate: 0 },
  { id: 'taiwan-mexico', from: 'Taiwan', to: 'Mexico', baseRate: 0 },
  { id: 'taiwan-vietnam', from: 'Taiwan', to: 'Vietnam', baseRate: 0 },
  { id: 'japan-mexico', from: 'Japan', to: 'Mexico', baseRate: 0 },
  { id: 'japan-vietnam', from: 'Japan', to: 'Vietnam', baseRate: 0 },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const calculateLandedCost = (oem, tariffs, data) => {
  let totalComponentCost = 0;
  let tariffImpact = 0;
  
  // Add component costs with tariffs
  Object.entries(oem.requires).forEach(([componentId, qty]) => {
    let component = null;
    let source = null;
    
    // Find component source
    const rm = data.rawMaterials.find(r => r.id === componentId);
    const c = data.tier1Components.find(c => c.id === componentId);
    
    if (rm) {
      component = rm;
      source = rm.source;
    } else if (c) {
      component = c;
      source = c.source;
    }
    
    if (component && source) {
      const lane = TARIFF_LANES.find(l => l.from === source && l.to === oem.location);
      const tariffRate = tariffs[lane?.id] || 0;
      const baseCost = component.cost * qty;
      const tariffAmount = baseCost * tariffRate;
      
      totalComponentCost += baseCost;
      tariffImpact += tariffAmount;
    }
  });
  
  const landedCost = totalComponentCost + oem.assemblyCost + tariffImpact;
  return { landedCost, tariffImpact, componentCost: totalComponentCost };
};

const calculateBottleneck = (data, selectedOem) => {
  if (!selectedOem) return { maxOutput: 0, bottlenecks: [] };
  
  const bottlenecks = [];
  
  // Check each required component
  Object.entries(selectedOem.requires).forEach(([componentId, qty]) => {
    const rm = data.rawMaterials.find(r => r.id === componentId);
    const c = data.tier1Components.find(c => c.id === componentId);
    
    let availableCapacity = 0;
    let componentName = '';
    
    if (rm) {
      availableCapacity = Math.floor(rm.currentCapacity / qty);
      componentName = rm.name;
    } else if (c) {
      availableCapacity = Math.floor(c.currentCapacity / qty);
      componentName = c.name;
    }
    
    bottlenecks.push({
      component: componentName,
      availableCapacity,
      requiredPerUnit: qty
    });
  });
  
  const maxOutput = Math.min(...bottlenecks.map(b => b.availableCapacity), selectedOem.currentCapacity);
  const constrainedBottlenecks = bottlenecks.filter(b => b.availableCapacity <= maxOutput + 1);
  
  return { maxOutput, bottlenecks: constrainedBottlenecks };
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function App() {
  const [data, setData] = useState(INITIAL_DATA);
  const [tariffs, setTariffs] = useState({});
  const [selectedNode, setSelectedNode] = useState(null);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const svgRef = useRef(null);
  
  // Calculate KPIs
  const kpis = useMemo(() => {
    const primaryOem = data.oemAssembly[0];
    const backupOem = data.oemAssembly[1];
    
    const primaryLanded = calculateLandedCost(primaryOem, tariffs, data);
    const backupLanded = calculateLandedCost(backupOem, tariffs, data);
    
    const primaryBottleneck = calculateBottleneck(data, primaryOem);
    const backupBottleneck = calculateBottleneck(data, backupOem);
    
    const totalDemand = data.markets.reduce((sum, m) => sum + m.demand, 0);
    const maxPrimaryOutput = Math.min(primaryBottleneck.maxOutput, primaryOem.currentCapacity);
    const maxBackupOutput = Math.min(backupBottleneck.maxOutput, backupOem.currentCapacity);
    const totalPossibleOutput = maxPrimaryOutput + maxBackupOutput;
    
    const fulfilledDemand = Math.min(totalDemand, totalPossibleOutput);
    const serviceLevel = totalDemand > 0 ? (fulfilledDemand / totalDemand) * 100 : 0;
    
    const revenueAtRisk = (totalDemand - fulfilledDemand) * 45; // Using avg price
    
    // Use primary OEM for main calculations
    const avgLandedCost = primaryLanded.landedCost;
    
    return {
      totalLandedCost: avgLandedCost,
      serviceLevel,
      revenueAtRisk: Math.max(0, revenueAtRisk),
      primaryLanded,
      backupLanded,
      maxPrimaryOutput,
      maxBackupOutput,
      totalDemand,
      fulfilledDemand
    };
  }, [data, tariffs]);
  
  // AI Rebalancing Logic
  useEffect(() => {
    const threshold = 18.0; // Cost threshold for triggering AI suggestion
    const shortageThreshold = 0.7; // 70% of demand
    
    if (kpis.primaryLanded.landedCost > threshold || 
        (kpis.totalDemand > 0 && kpis.fulfilledDemand / kpis.totalDemand < shortageThreshold)) {
      
      const savings = kpis.primaryLanded.landedCost - kpis.backupLanded.landedCost;
      const percentage = Math.round(((kpis.totalDemand - kpis.maxPrimaryOutput) / kpis.totalDemand) * 100);
      
      setAiSuggestion({
        type: kpis.primaryLanded.landedCost > threshold ? 'tariff' : 'shortage',
        message: `AI Suggestion: Rebalance ${Math.max(30, percentage)}% of production quota to Vietnam facility. This alternative routing avoids the China-to-Mexico tariff lane, restoring on-time delivery and improving landed cost performance.${savings > 0 ? ` Potential savings: $${savings.toFixed(2)}/unit.` : ''}`,
        savings: savings
      });
    } else {
      setAiSuggestion(null);
    }
  }, [kpis]);
  
  // D3 Visualization
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    
    const width = 900;
    const height = 500;
    
    svg.attr('width', width).attr('height', height);
    
    // Create node data
    const nodes = [];
    const links = [];
    
    // Add Raw Materials
    data.rawMaterials.forEach((rm, i) => {
      nodes.push({
        id: rm.id,
        name: rm.name,
        type: 'rawMaterial',
        x: 100,
        y: 100 + i * 150,
        source: rm.source,
        cost: rm.cost,
        capacity: rm.capacity,
        currentCapacity: rm.currentCapacity
      });
    });
    
    // Add Tier 1 Components
    data.tier1Components.forEach((c, i) => {
      nodes.push({
        id: c.id,
        name: c.name,
        type: 'tier1',
        x: 300,
        y: 80 + i * 100,
        source: c.source,
        cost: c.cost,
        capacity: c.capacity,
        currentCapacity: c.currentCapacity
      });
      
      // Link to consumed RM
      Object.keys(c.consumes).forEach(rmId => {
        links.push({ source: rmId, target: c.id, value: c.consumes[rmId] });
      });
    });
    
    // Add OEM Assembly
    data.oemAssembly.forEach((oem, i) => {
      nodes.push({
        id: oem.id,
        name: oem.name,
        type: 'oem',
        x: 550,
        y: 150 + i * 200,
        location: oem.location,
        assemblyCost: oem.assemblyCost,
        capacity: oem.capacity,
        currentCapacity: oem.currentCapacity
      });
      
      // Link to required components
      Object.entries(oem.requires).forEach(([compId, qty]) => {
        links.push({ source: compId, target: oem.id, value: qty });
      });
    });
    
    // Add Markets
    data.markets.forEach((m, i) => {
      nodes.push({
        id: m.id,
        name: m.name,
        type: 'market',
        x: 800,
        y: 150 + i * 200,
        demand: m.demand,
        price: m.price
      });
      
      // Link from OEMs to markets
      data.oemAssembly.forEach(oem => {
        links.push({ source: oem.id, target: m.id, value: 1 });
      });
    });
    
    // Color scale
    const colorScale = {
      rawMaterial: '#3b82f6',
      tier1: '#8b5cf6',
      oem: '#10b981',
      market: '#f59e0b'
    };
    
    // Draw links
    const linkGroup = svg.append('g').attr('class', 'links');
    
    const linksSelection = linkGroup.selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('x1', d => nodes.find(n => n.id === d.source)?.x || 0)
      .attr('y1', d => nodes.find(n => n.id === d.source)?.y || 0)
      .attr('x2', d => nodes.find(n => n.id === d.target)?.x || 0)
      .attr('y2', d => nodes.find(n => n.id === d.target)?.y || 0)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6);
    
    // Check if link crosses tariff-affected lanes
    linksSelection.each(function(d) {
      const sourceNode = nodes.find(n => n.id === d.source);
      const targetNode = nodes.find(n => n.id === d.target);
      
      if (sourceNode && targetNode) {
        let hasTariff = false;
        
        if (sourceNode.type === 'rawMaterial' || sourceNode.type === 'tier1') {
          const sourceCountry = sourceNode.source || sourceNode.location;
          const targetCountry = targetNode.location;
          const lane = TARIFF_LANES.find(l => l.from === sourceCountry && l.to === targetCountry);
          if (lane && tariffs[lane.id] > 0) {
            hasTariff = true;
          }
        }
        
        if (hasTariff) {
          d3.select(this)
            .attr('stroke', '#ef4444')
            .attr('stroke-width', 3)
            .attr('stroke-opacity', 0.9);
        }
      }
    });
    
    // Draw nodes
    const nodeGroup = svg.append('g').attr('class', 'nodes');
    
    const nodesSelection = nodeGroup.selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .on('click', (event, d) => setSelectedNode(d))
      .style('cursor', 'pointer');
    
    // Node circles
    nodesSelection.append('circle')
      .attr('r', 25)
      .attr('fill', d => colorScale[d.type])
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);
    
    // Node labels
    nodesSelection.append('text')
      .attr('dy', 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('font-weight', 'bold')
      .text(d => d.id.split('_').pop());
    
    // Node names below
    nodeGroup.selectAll('text.node-name')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', 'node-name')
      .attr('x', d => d.x)
      .attr('y', d => d.y + 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#475569')
      .attr('font-weight', '500')
      .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
    
  }, [data, tariffs]);
  
  // Handle capacity change
  const handleCapacityChange = (nodeType, nodeId, newCapacity) => {
    setData(prev => ({
      ...prev,
      [nodeType]: prev[nodeType].map(node => 
        node.id === nodeId 
          ? { ...node, currentCapacity: Math.max(0, parseInt(newCapacity) || 0) }
          : node
      )
    }));
  };
  
  // Handle tariff change
  const handleTariffChange = (laneId, rate) => {
    setTariffs(prev => ({
      ...prev,
      [laneId]: parseFloat(rate) || 0
    }));
  };
  
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar - Global KPIs */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Supply Chain Digital Twin Dashboard</h1>
        <div className="grid grid-cols-3 gap-6">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="text-sm text-blue-600 font-medium">Total Landed Cost (Primary OEM)</div>
            <div className="text-3xl font-bold text-blue-700">${kpis.totalLandedCost.toFixed(2)}</div>
            <div className="text-xs text-blue-500 mt-1">per unit assembled in Mexico</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="text-sm text-green-600 font-medium">Overall Service Level</div>
            <div className="text-3xl font-bold text-green-700">{kpis.serviceLevel.toFixed(1)}%</div>
            <div className="text-xs text-green-500 mt-1">{kpis.fulfilledDemand.toFixed(0)} / {kpis.totalDemand} units fulfilled</div>
          </div>
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="text-sm text-red-600 font-medium">Total Revenue at Risk</div>
            <div className="text-3xl font-bold text-red-700">${kpis.revenueAtRisk.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
            <div className="text-xs text-red-500 mt-1">from unfulfilled demand</div>
          </div>
        </div>
      </header>
      
      <div className="flex">
        {/* Main Panel - Network Graph */}
        <main className="flex-1 p-6">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-lg font-semibold text-slate-700">Supply Chain Network Map</h2>
              <p className="text-sm text-slate-500">Click on nodes to view details</p>
            </div>
            <div className="p-6">
              <svg ref={svgRef} className="w-full"></svg>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className="text-slate-600">Raw Materials</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                <span className="text-slate-600">Tier 1 Components</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                <span className="text-slate-600">OEM Assembly</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className="text-slate-600">Markets</span>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <div className="w-8 h-0.5 bg-red-500"></div>
                <span className="text-slate-600">Tariff-Impacted Flow</span>
              </div>
            </div>
          </div>
          
          {/* Selected Node Details */}
          {selectedNode && (
            <div className="mt-6 bg-white rounded-xl shadow-lg border border-slate-200 p-6">
              <h3 className="text-lg font-semibold text-slate-700 mb-4">Node Details: {selectedNode.name}</h3>
              <div className="grid grid-cols-2 gap-4">
                {selectedNode.type === 'rawMaterial' && (
                  <>
                    <div><span className="text-slate-500">Source:</span> <span className="font-medium">{selectedNode.source}</span></div>
                    <div><span className="text-slate-500">Unit Cost:</span> <span className="font-medium">${selectedNode.cost.toFixed(2)}</span></div>
                    <div><span className="text-slate-500">Max Capacity:</span> <span className="font-medium">{selectedNode.capacity.toLocaleString()}/wk</span></div>
                    <div><span className="text-slate-500">Current Capacity:</span> <span className="font-medium">{selectedNode.currentCapacity.toLocaleString()}/wk</span></div>
                  </>
                )}
                {selectedNode.type === 'tier1' && (
                  <>
                    <div><span className="text-slate-500">Source:</span> <span className="font-medium">{selectedNode.source}</span></div>
                    <div><span className="text-slate-500">Unit Cost:</span> <span className="font-medium">${selectedNode.cost.toFixed(2)}</span></div>
                    <div><span className="text-slate-500">Max Capacity:</span> <span className="font-medium">{selectedNode.capacity.toLocaleString()}/wk</span></div>
                    <div><span className="text-slate-500">Current Capacity:</span> <span className="font-medium">{selectedNode.currentCapacity.toLocaleString()}/wk</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Consumes:</span> <span className="font-medium">{Object.entries(selectedNode.consumes).map(([k,v]) => `${k}: ${v}`).join(', ') || 'None'}</span></div>
                  </>
                )}
                {selectedNode.type === 'oem' && (
                  <>
                    <div><span className="text-slate-500">Location:</span> <span className="font-medium">{selectedNode.location}</span></div>
                    <div><span className="text-slate-500">Assembly Cost:</span> <span className="font-medium">${selectedNode.assemblyCost.toFixed(2)}</span></div>
                    <div><span className="text-slate-500">Max Capacity:</span> <span className="font-medium">{selectedNode.capacity.toLocaleString()}/wk</span></div>
                    <div><span className="text-slate-500">Current Capacity:</span> <span className="font-medium">{selectedNode.currentCapacity.toLocaleString()}/wk</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Requires:</span> <span className="font-medium">{Object.entries(selectedNode.requires).map(([k,v]) => `${k}: ${v}`).join(', ')}</span></div>
                  </>
                )}
                {selectedNode.type === 'market' && (
                  <>
                    <div><span className="text-slate-500">Weekly Demand:</span> <span className="font-medium">{selectedNode.demand.toLocaleString()} units</span></div>
                    <div><span className="text-slate-500">Unit Price:</span> <span className="font-medium">${selectedNode.price.toFixed(2)}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Total Market Value:</span> <span className="font-medium">${(selectedNode.demand * selectedNode.price).toLocaleString(undefined, {maximumFractionDigits: 0})}/wk</span></div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
        
        {/* Control Panel - Right Side */}
        <aside className="w-96 bg-white border-l border-slate-200 p-6 space-y-6">
          {/* RM Shortage Simulation */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h3 className="text-md font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Scenario A: RM/Component Shortage
            </h3>
            <div className="space-y-3">
              {data.rawMaterials.map(rm => (
                <div key={rm.id}>
                  <label className="text-xs text-slate-600 block mb-1">{rm.name} ({rm.id})</label>
                  <input
                    type="range"
                    min="0"
                    max={rm.capacity}
                    value={rm.currentCapacity}
                    onChange={(e) => handleCapacityChange('rawMaterials', rm.id, e.target.value)}
                    className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="text-xs text-slate-500 mt-1">{rm.currentCapacity.toLocaleString()} / {rm.capacity.toLocaleString()} units/wk</div>
                </div>
              ))}
              {data.tier1Components.map(c => (
                <div key={c.id}>
                  <label className="text-xs text-slate-600 block mb-1">{c.name} ({c.id})</label>
                  <input
                    type="range"
                    min="0"
                    max={c.capacity}
                    value={c.currentCapacity}
                    onChange={(e) => handleCapacityChange('tier1Components', c.id, e.target.value)}
                    className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="text-xs text-slate-500 mt-1">{c.currentCapacity.toLocaleString()} / {c.capacity.toLocaleString()} units/wk</div>
                </div>
              ))}
            </div>
            
            {/* Bottleneck Analysis */}
            <div className="mt-4 pt-4 border-t border-slate-300">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Bottleneck Analysis (Primary OEM)</h4>
              {calculateBottleneck(data, data.oemAssembly[0]).bottlenecks.map((b, i) => (
                <div key={i} className="text-xs text-slate-600 py-1">
                  <span className="font-medium">{b.component}:</span> limits output to {b.availableCapacity.toLocaleString()} units
                </div>
              ))}
              <div className="text-sm font-semibold text-slate-800 mt-2">
                Max Possible Output: {calculateBottleneck(data, data.oemAssembly[0]).maxOutput.toLocaleString()} units/wk
              </div>
            </div>
          </div>
          
          {/* Tariff Simulation */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h3 className="text-md font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Scenario B: Tariff Escalation
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">China → Mexico (Section 301)</label>
                <input
                  type="range"
                  min="0"
                  max="0.40"
                  step="0.01"
                  value={tariffs['china-mexico'] || 0}
                  onChange={(e) => handleTariffChange('china-mexico', e.target.value)}
                  className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-slate-500 mt-1">{((tariffs['china-mexico'] || 0) * 100).toFixed(0)}% tariff</div>
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">China → Vietnam</label>
                <input
                  type="range"
                  min="0"
                  max="0.40"
                  step="0.01"
                  value={tariffs['china-vietnam'] || 0}
                  onChange={(e) => handleTariffChange('china-vietnam', e.target.value)}
                  className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-slate-500 mt-1">{((tariffs['china-vietnam'] || 0) * 100).toFixed(0)}% tariff</div>
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Germany → Mexico</label>
                <input
                  type="range"
                  min="0"
                  max="0.25"
                  step="0.01"
                  value={tariffs['germany-mexico'] || 0}
                  onChange={(e) => handleTariffChange('germany-mexico', e.target.value)}
                  className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-slate-500 mt-1">{((tariffs['germany-mexico'] || 0) * 100).toFixed(0)}% tariff</div>
              </div>
            </div>
            
            {/* Landed Cost Impact */}
            <div className="mt-4 pt-4 border-t border-slate-300">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Landed Cost Impact</h4>
              <div className="text-xs text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span>Primary (Mexico):</span>
                  <span className="font-medium">${kpis.primaryLanded.landedCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tariff Impact:</span>
                  <span className="font-medium text-red-600">+${kpis.primaryLanded.tariffImpact.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Backup (Vietnam):</span>
                  <span className="font-medium">${kpis.backupLanded.landedCost.toFixed(2)}</span>
                </div>
              </div>
              {kpis.primaryLanded.tariffImpact > 0 && (
                <div className="mt-2 text-xs bg-red-50 text-red-700 p-2 rounded border border-red-200">
                  Margin Compression: ${kpis.primaryLanded.tariffImpact.toFixed(2)} per unit
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      
      {/* Output Panel - Bottom Alerts */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg">
        <div className="px-6 py-4">
          <h3 className="text-md font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            AI Rebalancing Suggestions & Alerts
          </h3>
          
          {aiSuggestion ? (
            <div className={`rounded-lg p-4 border-l-4 ${aiSuggestion.type === 'tariff' ? 'bg-amber-50 border-amber-500' : 'bg-orange-50 border-orange-500'}`}>
              <div className="flex items-start gap-3">
                <svg className={`w-6 h-6 flex-shrink-0 ${aiSuggestion.type === 'tariff' ? 'text-amber-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div>
                  <p className="text-sm text-slate-700">{aiSuggestion.message}</p>
                  {aiSuggestion.savings > 0 && (
                    <p className="text-xs text-slate-500 mt-1">Estimated annual savings: ${(aiSuggestion.savings * 8000).toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg p-4 bg-green-50 border-l-4 border-green-500">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm text-green-700">Supply chain operating within optimal parameters. No rebalancing required.</p>
                  <p className="text-xs text-green-600 mt-1">Service level: {kpis.serviceLevel.toFixed(1)}% | Landed cost: ${kpis.totalLandedCost.toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Additional Alerts */}
          {kpis.serviceLevel < 90 && (
            <div className="mt-3 rounded-lg p-3 bg-red-50 border border-red-200">
              <p className="text-sm text-red-700 font-medium">⚠️ Service Level Alert: Current capacity constraints are impacting customer fulfillment.</p>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
