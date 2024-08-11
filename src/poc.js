import {Foundry} from '@adraffy/blocksmith';
import {EVMCommand, EVMProver, EVMRequest} from '@unruggable/evmgateway';
import {ethers} from 'ethers';

let foundry = await Foundry.launch();

let esp_storage = await foundry.deploy({
	sol: `
		contract ESPStorage {
			struct F {
				bytes getOwner;
				bytes isExpired;
			}
			mapping (address => F) fragments;
			function set(address a, bytes calldata getOwner, bytes calldata isExpired) external {
				fragments[a] = F(getOwner, isExpired);
			}
		}
	`
});

let contract_A = await foundry.deploy({
	sol: `
		contract A {
			mapping (uint256 => address) _owners;
			mapping (uint256 => uint256) _exps;
			function set(uint256 id, address owner, uint256 exp) external {
				_owners[id] = owner;
				_exps[id] = exp;
			}
		}
	`
});
let program_getOwner_A = new EVMCommand().setSlot(0).follow().read().encode();
let program_isExpired_A = new EVMCommand().setSlot(1).follow().read().encode();
// note: we don't have generalized comparisions or block.timestamp access yet

let contract_B = await foundry.deploy({
	sol: `
		contract B {
			uint256[4] pad;
			struct R {
				uint256 exp;
				address owner;
			}
			mapping (uint256 => R) _records;
			function set(uint256 id, address owner, uint256 exp) external {
				_records[id] = R(exp, owner);
			}
		}
	`
});
let program_getOwner_B = new EVMCommand().setSlot(4).follow().offset(1).read().encode();
let program_isExpired_B = new EVMCommand().setSlot(4).follow().read().encode();


await foundry.confirm(esp_storage.set(contract_A, program_getOwner_A, program_isExpired_A));
await foundry.confirm(esp_storage.set(contract_B, program_getOwner_B, program_isExpired_B));

await foundry.confirm(contract_A.set(1, '0x51050ec063d393217B436747617aD1C2285Aeeee', 1));
await foundry.confirm(contract_B.set(2, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 0));

let prover = await EVMProver.latest(foundry.provider);

async function read_owner(target, id) {
	let req = new EVMRequest(1)
		.push(id) // argument to program
		.setTarget(esp_storage.target)
		.setSlot(0).push(target).follow().readBytes() // read program
		.setTarget(target) // change target
		.eval({acquire: true}) // run program
		.setOutput(0);
	let state = await prover.evalRequest(req);
	let outputs = await state.resolveOutputs();
	return ethers.AbiCoder.defaultAbiCoder().decode(['address'], outputs[0])[0];
}

async function is_expired(target, id) {
	let req = new EVMRequest(1)
		.push(id) 
		.setTarget(esp_storage.target)
		.setSlot(0).push(target).follow().offset(1).readBytes() // read program
		.setTarget(target) // change target
		.eval({acquire: true}) // run program
		.setOutput(0)
	let state = await prover.evalRequest(req);
	let outputs = await state.resolveOutputs();
	return parseInt(outputs[0]) > 0;
}

console.log();
console.log('[owners]');
console.log(await read_owner(contract_A.target, 1));
console.log(await read_owner(contract_B.target, 2));

console.log();
console.log('[expired]');
console.log(await is_expired(contract_A.target, 1));
console.log(await is_expired(contract_B.target, 2));

console.log();
console.log(Object.fromEntries(Object.entries({
	program_getOwner_A,
	program_getOwner_B,
	program_isExpired_A,
	program_isExpired_B
}).map(([k, x]) => [k, ethers.dataLength(x)])));

foundry.shutdown();
