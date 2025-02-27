import "@tanssi/api-augment";
import { describeSuite, expect, beforeAll } from "@moonwall/cli";
import { KeyringPair } from "@moonwall/util";
import { ApiPromise } from "@polkadot/api";
import { jumpSessions } from "util/block";

describeSuite({
    id: "CPT0604",
    title: "Registrar test suite",
    foundationMethods: "dev",
    testCases: ({ it, context }) => {
        let polkadotJs: ApiPromise;
        let alice: KeyringPair;
        let bob: KeyringPair;
        let charlie: KeyringPair;

        beforeAll(() => {
            alice = context.keyring.alice;
            bob = context.keyring.bob;
            charlie = context.keyring.charlie;
            polkadotJs = context.polkadotJs();
        });

        it({
            id: "E01",
            title: "Can add registrar proxy and use it",
            test: async function () {
                // Setup proxy
                const delegate = charlie.address;
                const registrar_proxy = 6;
                const delay = 0;
                const tx = polkadotJs.tx.proxy.addProxy(delegate, registrar_proxy, delay);
                await context.createBlock([await tx.signAsync(bob)]);

                const events = await polkadotJs.query.system.events();
                const ev1 = events.filter((a) => {
                    return a.event.method == "ProxyAdded";
                });
                expect(ev1.length).to.be.equal(1);

                const proxies = await polkadotJs.query.proxy.proxies(bob.address);
                expect(proxies.toJSON()[0]).to.deep.equal([
                    {
                        delegate: charlie.address,
                        proxyType: "Registrar",
                        delay: 0,
                    },
                ]);

                // Use proxy
                await context.createBlock();

                const emptyGenesisData = () => {
                    const g = polkadotJs.createType("DpContainerChainGenesisDataContainerChainGenesisData", {
                        storage: [
                            {
                                key: "0x636f6465",
                                value: "0x010203040506",
                            },
                        ],
                        name: "0x436f6e7461696e657220436861696e2032303030",
                        id: "0x636f6e7461696e65722d636861696e2d32303030",
                        forkId: null,
                        extensions: "0x",
                        properties: {
                            tokenMetadata: {
                                tokenSymbol: "0x61626364",
                                ss58Format: 42,
                                tokenDecimals: 12,
                            },
                            isEthereum: false,
                        },
                    });
                    return g;
                };
                const containerChainGenesisData = emptyGenesisData();

                // assert we can inject on chain data with proxy
                const tx2 = polkadotJs.tx.proxy.proxy(
                    bob.address,
                    null,
                    polkadotJs.tx.registrar.register(2002, containerChainGenesisData, null)
                );
                await context.createBlock([await tx2.signAsync(charlie)]);
                // Check that the on chain genesis data is set correctly
                const onChainGenesisData = await polkadotJs.query.registrar.paraGenesisData(2002);
                // TODO: fix once we have types
                expect(emptyGenesisData().toJSON()).to.deep.equal(onChainGenesisData.toJSON());

                const profileId = await polkadotJs.query.dataPreservers.nextProfileId();
                const profileTx = polkadotJs.tx.dataPreservers.createProfile({
                    url: "dummy",
                    paraIds: "AnyParaId",
                    mode: "Bootnode",
                    assignmentRequest: "Free",
                });

                // assert we can inject bootnodes with proxy
                const tx3 = polkadotJs.tx.proxy.proxy(
                    bob.address,
                    null,
                    polkadotJs.tx.dataPreservers.startAssignment(profileId, 2002, "Free")
                );
                await context.createBlock([await profileTx.signAsync(alice), await tx3.signAsync(charlie)]);

                const assignments = await polkadotJs.query.dataPreservers.assignments(2002);
                expect(assignments.toJSON()).to.deep.equal([profileId.toJSON()]);
            },
        });

        it({
            id: "E02",
            title: "SudoRegistrar proxy works",
            test: async function () {
                // Proxy
                const delegate = charlie.address;
                const sudo_registrar_proxy = 7;
                const delay = 0;
                const tx = polkadotJs.tx.proxy.addProxy(delegate, sudo_registrar_proxy, delay);
                await context.createBlock();
                await context.createBlock([await tx.signAsync(alice)]);

                const events = await polkadotJs.query.system.events();
                const ev1 = events.filter((a) => {
                    return a.event.method == "ProxyAdded";
                });
                expect(ev1.length).to.be.equal(1);

                const proxies = await polkadotJs.query.proxy.proxies(alice.address);
                expect(proxies.toJSON()[0]).to.deep.equal([
                    {
                        delegate: charlie.address,
                        proxyType: "SudoRegistrar",
                        delay: 0,
                    },
                ]);

                // Registrar
                await context.createBlock();

                const currentSesssion = await polkadotJs.query.session.currentIndex();
                const sessionDelay = await polkadotJs.consts.registrar.sessionDelay;
                const expectedScheduledOnboarding =
                    BigInt(currentSesssion.toString()) + BigInt(sessionDelay.toString());

                const emptyGenesisData = () => {
                    const g = polkadotJs.createType("DpContainerChainGenesisDataContainerChainGenesisData", {
                        storage: [
                            {
                                key: "0x636f6465",
                                value: "0x010203040506",
                            },
                        ],
                        name: "0x436f6e7461696e657220436861696e2032303030",
                        id: "0x636f6e7461696e65722d636861696e2d32303030",
                        forkId: null,
                        extensions: "0x",
                        properties: {
                            tokenMetadata: {
                                tokenSymbol: "0x61626364",
                                ss58Format: 42,
                                tokenDecimals: 12,
                            },
                            isEthereum: false,
                        },
                    });
                    return g;
                };
                const containerChainGenesisData = emptyGenesisData();

                const tx2 = polkadotJs.tx.registrar.register(2002, containerChainGenesisData, null);
                const tx3 = polkadotJs.tx.registrar.markValidForCollating(2002);
                const nonce = await polkadotJs.rpc.system.accountNextIndex(alice.publicKey);
                await context.createBlock([
                    await tx2.signAsync(alice, { nonce }),
                    await polkadotJs.tx.proxy
                        .proxy(alice.address, null, polkadotJs.tx.sudo.sudo(tx3))
                        .signAsync(charlie),
                ]);

                const pendingParas = await polkadotJs.query.registrar.pendingParaIds();
                expect(pendingParas.length).to.be.eq(1);
                const sessionScheduling = pendingParas[0][0];
                const parasScheduled = pendingParas[0][1];

                expect(sessionScheduling.toBigInt()).to.be.eq(expectedScheduledOnboarding);

                // These will be the paras in session 2
                // TODO: fix once we have types
                expect(parasScheduled.toJSON()).to.deep.equal([2000, 2001, 2002]);

                // Check that the on chain genesis data is set correctly
                const onChainGenesisData = await polkadotJs.query.registrar.paraGenesisData(2002);
                // TODO: fix once we have types
                expect(emptyGenesisData().toJSON()).to.deep.equal(onChainGenesisData.toJSON());

                // Check the para id has been given some free credits
                const credits = (await polkadotJs.query.servicesPayment.blockProductionCredits(2002)).toJSON();
                expect(credits, "Container chain 2002 should have been given credits").toBeGreaterThan(0);

                // Checking that in session 2 paras are registered
                await jumpSessions(context, 2);

                // Expect now paraIds to be registered
                const parasRegistered = await polkadotJs.query.registrar.registeredParaIds();
                // TODO: fix once we have types
                expect(parasRegistered.toJSON()).to.deep.equal([2000, 2001, 2002]);
            },
        });
    },
});
