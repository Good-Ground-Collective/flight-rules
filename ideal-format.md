---
purpose: the ideal format for an epic, can be adjusted to fit an initiative and a story
---

# Title 

## Problem Statement

What is the problem we are solving, in a single sentence. This should be the grounding source from the rest of the information below. Everything should be tied back to an improvement to our product

> Example:
> Our agent pipeline os relying too heavily on direct gh cli usage, leading to hallucinations and unsafe actions against our repositories when committing code

## Solution

What we will build to solve this issue, in short. Similar to the problem statement, this should be a condensed set of goal posts which are used to ground the output in reality. Oftentimes this will be a leading statement followed by a bulleted list of features or functionality.

> Example:
> We'll create an in-house cli which wraps the gh cli, and exposes a collection of deterministic commands which our agents can call. These commands will codify "our" way of interacting with our remote git repositories, covering interaction such as:
> - writing a proper commit message
> - opening a new pull request
> - responding to a code review comment

## Background

This section covers "why" we're doing something in greater depth. It is not always necessary, especially if the solution section alone exhaustively covers what we'll build. However, it is useful for providing additional context that might not fit neatly into a declarative product objective

## Technical Notes

This is where we would provide any technical details that are important to the solution. This could be as in-depth as a design diagram, declarative such as a zod schema, or simply a nudge in the right direction like "we already use inngest as our job runner, so we'll want to build this in an inngest native fashion"

## Known Gaps And Edge Cases

This is an area to call out things that could send this project sideways. The two most notable would be areas that will be explicitly thorny (our commits are required to be signed by a GPG key, but the keys belong to each developer, we'll need to figure out a way to register these for the agents and use them each time.) or areas we wan't to avoid entirely (a subset of the company still uses subversion for version control, we're explicitly ignoring them from this implementation. We only need to worry about our teams that use git.)
