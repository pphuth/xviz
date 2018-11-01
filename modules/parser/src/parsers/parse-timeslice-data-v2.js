// Copyright (c) 2019 Uber Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Extracts a TIMESLICE message v2
import {LOG_STREAM_MESSAGE} from '../constants';
import {getXvizConfig} from '../config/xviz-config';
import {parseXVIZPose} from './parse-xviz-pose';
import {
  parseStreamFutures,
  parseStreamPrimitive,
  parseStreamVariable,
  parseStreamTimeSeries
} from './parse-xviz-stream';

/* eslint-disable camelcase */

export default function parseTimesliceData(data, convertPrimitive) {
  const {update_type, updates} = data;

  if (update_type !== 'snapshot') {
    throw new Error(
      `Only XVIZ update_type of "snapshot" is currently supported. Type "${update_type}" is not supported.`
    );
  }

  if (updates.length > 1) {
    throw new Error(
      `Only XVIZ first update of "snapshot" is currently supported. Current updates has "${
        updates.length
      }" entries.`
    );
  }

  const stateUpdates = updates;

  let timestamp = data.timestamp;
  if (!timestamp && stateUpdates) {
    timestamp = stateUpdates.reduce((t, stateUpdate) => {
      return Math.max(t, stateUpdate.timestamp);
    }, 0);
  }

  if (!timestamp) {
    // Incomplete stream message, just tag it accordingly so client can ignore it
    return {type: LOG_STREAM_MESSAGE.INCOMPLETE};
  }

  const newStreams = {};
  const result = {
    type: LOG_STREAM_MESSAGE.TIMESLICE,
    streams: newStreams,
    timestamp
    // TODO/Xintong validate primary vehicle pose in each update?
  };

  if (stateUpdates) {
    const xvizStreams = parseStateUpdates(stateUpdates, timestamp, convertPrimitive);
    Object.assign(newStreams, xvizStreams);
  }

  return result;
}

function parseStateUpdates(stateUpdates, timestamp, convertPrimitive) {
  const {STREAM_BLACKLIST} = getXvizConfig();

  const newStreams = {};
  const poses = {};
  const primitives = {};
  const variables = {};
  const timeSeries = [];
  const futures = {};

  for (const stateUpdate of stateUpdates) {
    Object.assign(poses, stateUpdate.poses);
    Object.assign(primitives, stateUpdate.primitives);
    Object.assign(variables, stateUpdate.variables);
    Object.assign(futures, stateUpdate.future_instances);

    if (stateUpdate.time_series) {
      if (timeSeries) {
        timeSeries.push(...stateUpdate.time_series);
      }
    }
  }

  Object.keys(poses)
    .filter(streamName => !STREAM_BLACKLIST.has(streamName))
    .forEach(streamName => {
      newStreams[streamName] = parseXVIZPose(poses[streamName]);
    });

  Object.keys(primitives)
    .filter(streamName => !STREAM_BLACKLIST.has(streamName))
    .forEach(primitive => {
      newStreams[primitive] = parseStreamPrimitive(
        primitives[primitive],
        primitive,
        timestamp,
        convertPrimitive
      );
    });

  Object.keys(variables)
    .filter(streamName => !STREAM_BLACKLIST.has(streamName))
    .forEach(variable => {
      newStreams[variable] = parseStreamVariable(
        variables[variable].variables,
        variable,
        timestamp
      );
    });

  if (timeSeries.length) {
    const timeSeriesStreams = parseStreamTimeSeries(timeSeries, STREAM_BLACKLIST);
    Object.assign(newStreams, timeSeriesStreams);
  }

  Object.keys(futures)
    .filter(streamName => !STREAM_BLACKLIST.has(streamName))
    .forEach(future => {
      newStreams[future] = parseStreamFutures(futures[future], future, timestamp, convertPrimitive);
    });

  return newStreams;
}