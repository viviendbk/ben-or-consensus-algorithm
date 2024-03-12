import bodyParser from "body-parser";
import express from "express";
import {BASE_NODE_PORT} from "../config";
import {Value, NodeState} from "../types";
import {delay} from "../utils";
import * as console from "console";

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
    const node = express();
    node.use(express.json());
    node.use(bodyParser.json());

    let currentState: NodeState = {
        killed: isFaulty,
        x: isFaulty ? null : initialValue,
        decided: isFaulty ? null : false,
        k: isFaulty ? null : 0
    };

    const incomingMessages: any[] = [];
    let proposals: Map<number, Value[]> = new Map();
    let votes: Map<number, Value[]> = new Map();

    // Route to get the status of the node
    node.get("/status", (req, res) => {
        if (currentState.killed) {
            res.status(500).send("faulty");
        } else {
            res.status(200).send("live");
        }
    });

    // TODO implement this
    // this route allows the node to receive messages from other nodes
    node.post("/message", (req, res) => {
        let {k, x, messageType} = req.body;
        if (!currentState.killed) {
            if (messageType === "proposal phase") {
                if (!proposals.has(k)) {
                    proposals.set(k, []);
                }
                proposals.get(k)!.push(x);

                if (proposals.get(k)!?.length >= (N - F)) {
                    let values = proposals.get(k)!;
                    let count0 = 0;
                    let count1 = 0;
                    for (let i = 0; i < values.length; i++) {
                        if (values[i] === 0) {
                            count0++;
                        } else if (values[i] === 1) {
                            count1++;
                        }
                    }
                    if (count0 > count1) {
                        x = 0;
                    } else if (count1 > count0) {
                        x = 1;
                    } else {
                        x = "?";
                    }

                    console.log(`Node ${nodeId} decided on value ${x} for k = ${k}`)
                    for (let i = 0; i < N; i++) {
                        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({k: k, x: x, messageType: "voting phase"}),
                        });
                    }

                }
            } else if (messageType === "voting phase") {
                if (!votes.has(k)) {
                    votes.set(k, []);
                }
                votes.get(k)!.push(x);
                if (votes.get(k)!?.length >= (N - F)) {
                    let values = votes.get(k)!;
                    let count0 = 0;
                    let count1 = 0;
                    for (let i = 0; i < values.length; i++) {
                        if (values[i] === 0) {
                            count0++;
                        } else if (values[i] === 1) {
                            count1++;
                        }
                    }
                    if (count0 > F) {
                        currentState.x = 0;
                        currentState.decided = true;
                    } else if (count1 > F) {
                        currentState.x = 1;
                        currentState.decided = true;
                    } else {
                        if (count0 + count1 > 0 && count0 > count1) {
                            currentState.x = 0;
                        } else if (count0 + count1 > 0 && count0 < count1) {
                            currentState.x = 1;
                        } else {
                            currentState.x = Math.random() > 0.5 ? 0 : 1;
                        }
                    }
                    delay(200)

                    //TODO call all getState of nodes and check if all are decided
                    // if yes, call all stop route of nodes

                    let allDecided = true;
                    for (let i = 0; i < N; i++) {
                        // Call getState of each node
                        fetch(`http://localhost:${BASE_NODE_PORT + i}/getState`, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                        }).then(response => response.json())
                            .then(data => {
                                // @ts-ignore
                                if (!data.decided) {
                                    allDecided = false;
                                }
                                // If this is the last node and all have decided, stop all nodes
                                if (i === N - 1 && allDecided) {
                                    for (let j = 0; j < N; j++) {
                                        fetch(`http://localhost:${BASE_NODE_PORT + j}/stop`, {
                                            method: 'GET',
                                            headers: {
                                                'Content-Type': 'application/json',
                                            },
                                        });
                                    }
                                }
                            });
                    }

                    currentState.k = k + 1;

                    for (let i = 0; i < N; i++) {
                        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({k: currentState.k, x: currentState.x, messageType: "proposal phase"}),
                        });
                    }
                }

            }
            res.status(200).json({message: "Message received"});
        }
    });

    // TODO implement this
    // this route is used to start the consensus algorithm
    node.get("/start", async (req, res) => {
        while (!nodesAreReady()) {
            await delay(5);
        }
        if (!currentState.killed) {
            currentState.k = 1;
            for (let i = 0; i < N; i++) {
                fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        x: currentState.x!,
                        k: currentState.k!,
                        messageType: "proposal phase"
                    })
                });
            }
        }
        res.status(200).json({message: "Algorithm started"});
    });

    // this route is used to stop the consensus algorithm
    node.get("/stop", async (req, res) => {
        currentState.killed = true;
        res.status(200).send("killed");
    });

    // Route to get the current state of the node
    node.get("/getState", (req, res) => {
        res.status(200).send(currentState);
    });

    // start the server
    const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
        console.log(
            `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
        );

        // the node is ready
        setNodeIsReady(nodeId);
    });

    return server;
}
