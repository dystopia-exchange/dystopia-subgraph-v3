# Cone Subgraph
![TESTS](https://github.com/cone-exchange/cone-subgraph/actions/workflows/test.yml/badge.svg)


## Install

Install dependencies `npm install`

Generate types `npm run codegen`

Build the project `npm run build`

Very useful deploy subgraph on the local [graph-node](https://github.com/graphprotocol/graph-node).


## Testing

More about tests on [matchstick](https://thegraph.com/docs/en/developer/matchstick/)

On Linux/MacOS run tests should work with `graph test`

On Windows you can run test with following command (make sure you have installed docker)

`docker run -t --rm --mount type=bind,source=<ABSOLUTE_PATH_TO_REPO>,target=/matchstick belbix/subgraph:matchstick`

For run concrete test you can add env variables to the docker run like `-e ARGS="controller"`

Or build your own Docker image from [Dokerfile](./Dockerfile)
