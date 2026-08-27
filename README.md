# Casualties Hub Dynamic Configuration

Configuration for Casualties Hub desktop app.

## Editing configuration

Edit `config/v1/hub.json` (stable) or `config/v1/prerelease/hub.json` (prerelease).
Adding new optional fields is fine, adding mandatory fields or changing existing field definitions requires version increase (see below)

When adding announcements make sure to use unique id.
You can check if its a valid configuration according to schema by running the local check. 

Open a PR. It validates automatically.
After its merged it will publish automatically.

### Local check

```bash
cd build
npm ci
npm run check
```

## Published URLs

Base: [`https://casualties-hub.github.io/casualties-hub-config`](https://casualties-hub.github.io/casualties-hub-config/)

| Path | Serves |
| --- | --- |
| [`/v1/hub.json`](https://casualties-hub.github.io/casualties-hub-config/v1/hub.json) | channel `stable`, public releases |
| [`/v1/prerelease/hub.json`](https://casualties-hub.github.io/casualties-hub-config/v1/prerelease/hub.json) | channel `prerelease`, pre-release testers |
| [`/v1/hub.schema.json`](https://casualties-hub.github.io/casualties-hub-config/v1/hub.schema.json) | the `v1` schema |

## Layout

```
config/v1/hub.schema.json       the schema for every v1 document
config/v1/hub.json              channel stable      -> /v1/hub.json
config/v1/prerelease/hub.json   channel prerelease  -> /v1/prerelease/hub.json
build/                          the validator and its dependencies
```

A subdirectory of a version is a channel.
Channels always share the schema, there can be any number of channels.

The schema version is in the URL, not the document.
So `v1` keeps being available after `v2` releases.

## Adding a version

Increase version when a breaking change is required, such as removing or renaming a field, or making an optional field required.
Adding an optional field does not need version increase.

1. Copy the whole version folder.

   ```bash
   cp -r config/v1 config/v2
   ```

2. Open `config/v2/hub.schema.json` and change its `$id` to end `/v2/hub.schema.json`.

   Every schema has an unique `$id` so the copy needs to be updated with new id.
   `$schema` lines in the copied `hub.json` dont need to be edited as they are relative.

3. Make your change in `config/v2` and merge request.
