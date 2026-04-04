export const PolymarketOracleABI = [
	// -------------------------------------------------------------------------
	// CRE IReceiver
	// -------------------------------------------------------------------------
	{
		name: 'onReport',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'metadata', type: 'bytes' },
			{ name: 'report', type: 'bytes' },
		],
		outputs: [],
	},
	{
		name: 'supportsInterface',
		type: 'function',
		stateMutability: 'pure',
		inputs: [{ name: 'interfaceId', type: 'bytes4' }],
		outputs: [{ name: '', type: 'bool' }],
	},

	// -------------------------------------------------------------------------
	// updateMarkets — encoded into the report payload by the CRE workflow
	// (not called directly; selector used for report encoding)
	// -------------------------------------------------------------------------
	{
		name: 'updateMarkets',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'markets',
				type: 'tuple[]',
				components: [
					{ name: 'conditionId', type: 'bytes32' },
					{ name: 'question', type: 'string' },
					{ name: 'endDate', type: 'uint256' },
					{ name: 'active', type: 'bool' },
				],
			},
		],
		outputs: [],
	},

	// -------------------------------------------------------------------------
	// Read helpers
	// -------------------------------------------------------------------------
	{
		name: 'getMarket',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'conditionId', type: 'bytes32' }],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{ name: 'conditionId', type: 'bytes32' },
					{ name: 'question', type: 'string' },
					{ name: 'endDate', type: 'uint256' },
					{ name: 'active', type: 'bool' },
					{ name: 'lastUpdate', type: 'uint256' },
				],
			},
		],
	},
	{
		name: 'getActiveConditionIds',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'bytes32[]' }],
	},
	{
		name: 'totalMarkets',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'uint256' }],
	},

	// -------------------------------------------------------------------------
	// Immutables
	// -------------------------------------------------------------------------
	{
		name: 'EXPECTED_AUTHOR',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
	},
	{
		name: 'EXPECTED_WORKFLOW_NAME',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'bytes10' }],
	},

	// -------------------------------------------------------------------------
	// Events
	// -------------------------------------------------------------------------
	{
		name: 'MarketsUpdated',
		type: 'event',
		anonymous: false,
		inputs: [
			{ name: 'count', type: 'uint256', indexed: false },
			{ name: 'timestamp', type: 'uint256', indexed: false },
		],
	},

	// -------------------------------------------------------------------------
	// Errors
	// -------------------------------------------------------------------------
	{
		name: 'InvalidAuthor',
		type: 'error',
		inputs: [
			{ name: 'received', type: 'address' },
			{ name: 'expected', type: 'address' },
		],
	},
	{
		name: 'InvalidWorkflowName',
		type: 'error',
		inputs: [
			{ name: 'received', type: 'bytes10' },
			{ name: 'expected', type: 'bytes10' },
		],
	},
] as const
